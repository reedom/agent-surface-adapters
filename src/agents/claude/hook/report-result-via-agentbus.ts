import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { send as agentbusSend } from '../../../core/agentbus.js';
import { findTranscript } from '../result.js';

type SendFn = (to: string, from: string, payload: unknown) => Promise<void>;

export interface ResultHookDeps {
  send?: SendFn;
  readLastAssistantText?: (transcriptPath: string) => string | null;
  findTranscript?: (sessionId: string) => string | null;
  /** Test seam for the flush-retry delay. */
  sleep?: (ms: number) => Promise<void>;
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
  await send(meta.nagiInstance, `ext:awe-${meta.runId}`, {
    type: 'result',
    runId: meta.runId,
    text: text ?? '',
  });
  return JSON.stringify({}); // no decision field => allow the agent to stop
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
