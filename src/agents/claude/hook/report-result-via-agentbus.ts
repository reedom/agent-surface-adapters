import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { send as agentbusSend } from '../../../core/agentbus.js';
import { extractJsonObject, validateAgainstSchema, type JsonSchema } from '../../../core/validate.js';
import { findTranscript } from '../result.js';

type SendFn = (to: string, from: string, payload: unknown) => Promise<void>;

/** Default cap on Stop-hook repair rounds before the run is reported as failed. */
const DEFAULT_MAX_REPAIRS = 3;

export interface ResultHookDeps {
  send?: SendFn;
  readLastAssistantText?: (transcriptPath: string) => string | null;
  findTranscript?: (sessionId: string) => string | null;
  /** Test seam for the flush-retry delay. */
  sleep?: (ms: number) => Promise<void>;
  /** Test seam: read the declared JSON Schema from its file. */
  readSchema?: (schemaPath: string) => JsonSchema | null;
  /** Test seams for the per-step repair-attempt counter (keyed by the attempts file path). */
  readAttempts?: (path: string) => number;
  writeAttempts?: (path: string, n: number) => void;
}

function defaultReadSchema(schemaPath: string): JsonSchema | null {
  if (!existsSync(schemaPath)) return null;
  try {
    return JSON.parse(readFileSync(schemaPath, 'utf8')) as JsonSchema;
  } catch {
    return null;
  }
}

// The repair counter is keyed by sessionId, not runId: on the surfaced lane the runId
// (and thus runDir) is shared by every step of a multi-step run, but each step gets a
// fresh sessionId — so per-session keying gives each step its own repair budget.
function attemptsPath(runDir: string, key: string): string {
  return join(runDir, `repair-attempts-${key}`);
}
export function defaultReadAttempts(path: string): number {
  if (!existsSync(path)) return 0;
  const raw = readFileSync(path, 'utf8').trim();
  // A corrupt counter must fail SAFE (treat as at-cap), never reset the loop bound.
  // parseInt is too lenient ("1oops" -> 1, "-1" -> -1), so require a strictly
  // non-negative integer string before trusting it.
  if (!/^\d+$/.test(raw)) return Number.MAX_SAFE_INTEGER;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : Number.MAX_SAFE_INTEGER;
}
function defaultWriteAttempts(path: string, n: number): void {
  writeFileSync(path, String(n));
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function takeArg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  if (i < 0) return undefined;
  return argv[i + 1];
}

function extractText(content: unknown): string | null {
  if (typeof content === 'string') {
    const t = content.trim();
    return t.length !== 0 ? t : null;
  }
  if (Array.isArray(content)) {
    const parts = content
      .map((b) => (typeof b === 'object' && b !== null ? (b as { type?: string; text?: string }) : null))
      .filter((b): b is { type?: string; text?: string } => b !== null && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text as string);
    const joined = parts.join('\n').trim();
    return joined.length !== 0 ? joined : null;
  }
  return null;
}

/** Text of the last assistant message in a Claude Code JSONL transcript, or null. */
export function lastAssistantText(transcriptPath: string): string | null {
  if (!existsSync(transcriptPath)) return null;
  const lines = readFileSync(transcriptPath, 'utf8').split('\n').filter(Boolean);
  for (let i = lines.length - 1; 0 <= i; i--) {
    try {
      const ev = JSON.parse(lines[i]) as { type?: string; message?: { role?: string; content?: unknown } };
      const isAssistant = ev.type === 'assistant' || ev.message?.role === 'assistant';
      if (!isAssistant) continue;
      const text = extractText(ev.message?.content);
      if (text) return text;
    } catch {
      // skip malformed lines
    }
  }
  return null;
}

/**
 * Stop-hook helper: when the agent finishes a turn, read its final assistant
 * message from the transcript and report it as the run's result over agentbus.
 * This makes result reporting deterministic (the harness reports), instead of
 * relying on the interactive model to remember to run a closing `agentbus send`.
 * It ALWAYS allows the agent to stop (never blocks); a missing result is handled
 * by nagi's wait-ceiling.
 */
export async function runResultHook(argv: string[], stdinJson: string, deps: ResultHookDeps = {}): Promise<string> {
  const metaPath = takeArg(argv, '--meta');
  if (!metaPath) throw new Error('usage: report-result-via-agentbus --meta <file>');
  const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as {
    runId: string;
    sessionId?: string;
    nagiInstance: string;
    schemaPath?: string;
    maxRepairs?: number;
  };
  const hook = JSON.parse(stdinJson) as { transcript_path?: string };
  const readText = deps.readLastAssistantText ?? lastAssistantText;
  const resolveTranscript = deps.findTranscript ?? findTranscript;
  const sleep = deps.sleep ?? defaultSleep;

  // The hook-supplied path is primary; a deterministic lookup by sessionId is the
  // fallback (the transcript file is named <sessionId>.jsonl). Retry briefly to
  // absorb any lag between the turn ending and the final message being flushed.
  const candidates = (): string[] => {
    const list: string[] = [];
    if (typeof hook.transcript_path === 'string' && hook.transcript_path.length !== 0) list.push(hook.transcript_path);
    const byId = meta.sessionId ? resolveTranscript(meta.sessionId) : null;
    if (byId) list.push(byId);
    return list;
  };

  let text: string | null = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    for (const path of candidates()) {
      text = readText(path);
      if (text) break;
    }
    if (text) break;
    await sleep(250);
  }

  const send = deps.send ?? agentbusSend;
  const from = `ext:awe-${meta.runId}`;
  const finalText = text ?? '';

  // No schema declared (seed surface / free-text steps): report the text, allow stop.
  if (!meta.schemaPath) {
    await send(meta.nagiInstance, from, { type: 'result', runId: meta.runId, text: finalText });
    return JSON.stringify({}); // no decision field => allow the agent to stop
  }

  // Schema declared: validate the agent's final JSON and either report structured
  // data, or block the stop and feed errors back so it repairs (bounded retries).
  const readSchema = deps.readSchema ?? defaultReadSchema;
  const schema = readSchema(meta.schemaPath);
  if (!schema) {
    // A schema was declared but cannot be read (missing/corrupt) — that is an internal
    // anomaly, not a free-text step, so report it as a failure (don't silently degrade
    // to text and let it resurface downstream as an undefined-data error).
    await send(meta.nagiInstance, from, {
      type: 'result',
      runId: meta.runId,
      text: finalText,
      error: `declared schema could not be read: ${meta.schemaPath}`,
    });
    return JSON.stringify({});
  }

  const data = extractJsonObject(finalText);
  const validation =
    data === undefined
      ? { ok: false, errors: ['final message was not a JSON object'] }
      : validateAgainstSchema(data, schema);

  if (validation.ok) {
    await send(meta.nagiInstance, from, { type: 'result', runId: meta.runId, text: finalText, data });
    return JSON.stringify({});
  }

  const runDir = dirname(metaPath);
  const apath = attemptsPath(runDir, meta.sessionId ?? meta.runId);
  const readAttempts = deps.readAttempts ?? defaultReadAttempts;
  const writeAttempts = deps.writeAttempts ?? defaultWriteAttempts;
  const attempt = readAttempts(apath);
  // Only a non-negative integer is a valid bound; anything else (negative, fractional)
  // would otherwise be accepted by `typeof === 'number'` and silently skip the loop.
  const declaredMax = meta.maxRepairs;
  const max =
    typeof declaredMax === 'number' && Number.isInteger(declaredMax) && 0 <= declaredMax
      ? declaredMax
      : DEFAULT_MAX_REPAIRS;

  if (attempt < max) {
    writeAttempts(apath, attempt + 1);
    // Block the stop and feed validation errors back so the agent re-emits valid JSON.
    // The Claude-facing channel on a Stop block is hookSpecificOutput.additionalContext;
    // we put the SAME actionable feedback in `reason` too (belt-and-suspenders across
    // Claude Code versions, and `reason` is what a human sees), so the repair loop is
    // always told what to fix, not just to retry.
    const feedback =
      'Your final message must be ONLY a JSON object matching the required schema, with no prose or code fences. ' +
      `Validation errors:\n- ${validation.errors.join('\n- ')}\n` +
      'Re-output the corrected JSON object as your final message now.';
    return JSON.stringify({
      decision: 'block',
      reason: feedback,
      hookSpecificOutput: { hookEventName: 'Stop', additionalContext: feedback },
    });
  }

  // Repairs exhausted: report a failed result so nagi unblocks (otherwise its wait
  // ceiling would hang); the workflow's own schema parse surfaces the failure.
  await send(meta.nagiInstance, from, {
    type: 'result',
    runId: meta.runId,
    text: finalText,
    error: `schema validation failed after ${max} repair attempt(s): ${validation.errors.join('; ')}`,
  });
  return JSON.stringify({});
}

async function readAllStdin(): Promise<string> {
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  readAllStdin()
    .then((stdin) => runResultHook(process.argv.slice(2), stdin))
    .then((out) => {
      process.stdout.write(`${out}\n`);
      process.exit(0);
    })
    .catch((err) => {
      process.stderr.write(`report-result-hook: ${err instanceof Error ? err.message : String(err)}\n`);
      // Allow the agent to stop even if reporting failed; nagi's ceiling handles the missing result.
      process.stdout.write(`${JSON.stringify({})}\n`);
      process.exit(0);
    });
}
