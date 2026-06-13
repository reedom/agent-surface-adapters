import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { askApproval, type Decision } from '../../../core/agentbus.js';

type AskFn = (to: string, from: string, timeoutMs: number, payload: unknown) => Promise<Decision>;

export interface HookDeps {
  ask?: AskFn;
}

function takeArg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  if (i < 0) return undefined;
  return argv[i + 1];
}

/**
 * Split a command into its top-level pipe segments, scanning OUTSIDE single/double
 * quotes. Returns null when a top-level shell control operator (`;` `&&` `||` `&`
 * backtick `$(` newline, or an unterminated quote) appears — i.e. the command is
 * more than one simple pipeline and must never be treated as a pure self-report.
 */
function topLevelPipeline(command: string): string[] | null {
  const segments: string[] = [];
  let current = '';
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    const next = command[i + 1];
    if (quote) {
      if (ch === quote) quote = null;
      current += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === ';' || ch === '\n' || ch === '`') return null;
    if (ch === '$' && next === '(') return null;
    if (ch === '&') return null; // covers `&` and `&&`
    if (ch === '|' && next === '|') return null; // `||`
    if (ch === '|') {
      segments.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (quote) return null; // unterminated quote
  segments.push(current);
  return segments;
}

/**
 * True when the Bash command is SOLELY the agent's own agentbus reporting to
 * nagiInstance: a single simple pipeline of an optional printf/echo feeder piped
 * into one `agentbus send <nagi>` / `agentbus reply <id> <nagi>` / `agentbus
 * publish`. Any top-level chaining means it is not a pure self-report (the gate is
 * never widened to let an arbitrary command ride along).
 */
export function isSelfReport(toolName: string, toolInput: unknown, nagiInstance: string): boolean {
  if (toolName !== 'Bash') return false;
  const command = (toolInput as { command?: unknown })?.command;
  if (typeof command !== 'string') return false;
  const segments = topLevelPipeline(command);
  if (!segments) return false;
  const trimmed = segments.map((s) => s.trim());
  if (2 < trimmed.length) return false; // at most: `<feeder> | agentbus ...`
  if (trimmed.length === 2 && !/^(printf|echo)\b/.test(trimmed[0] ?? '')) return false;
  const report = trimmed[trimmed.length - 1] ?? '';
  const m = report.match(/^agentbus\s+(send|reply|publish)\b(.*)$/);
  if (!m) return false;
  const verb = m[1];
  const tokens = (m[2] ?? '').trim().split(/\s+/).filter((t) => t.length !== 0);
  if (verb === 'publish') return true;
  if (verb === 'reply') return tokens[1] === nagiInstance; // reply <request_id> <from>
  return tokens[0] === nagiInstance; // send <to>
}

function decisionJson(behavior: 'allow' | 'deny', reason: string): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: behavior,
      permissionDecisionReason: reason,
    },
  });
}

export async function runApprovalHook(argv: string[], stdinJson: string, deps: HookDeps = {}): Promise<string> {
  const metaPath = takeArg(argv, '--meta');
  if (!metaPath) throw new Error('usage: approve-via-agentbus --meta <file>');
  const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as {
    runId: string;
    nagiInstance: string;
    timeoutMs: number;
  };
  const hook = JSON.parse(stdinJson) as { tool_name?: string; tool_input?: unknown; cwd?: string };
  if (isSelfReport(hook.tool_name ?? '', hook.tool_input, meta.nagiInstance)) {
    return decisionJson('allow', 'agentbus self-report');
  }
  const ask = deps.ask ?? askApproval;
  const payload = {
    type: 'approval',
    runId: meta.runId,
    tool: hook.tool_name ?? '',
    input: hook.tool_input,
    cwd: hook.cwd,
  };
  const decision = await ask(meta.nagiInstance, `ext:awe-${meta.runId}`, meta.timeoutMs, payload);
  return decisionJson(decision.behavior, decision.reason ?? `agentbus: ${decision.behavior}`);
}

async function readAllStdin(): Promise<string> {
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  readAllStdin()
    .then((stdin) => runApprovalHook(process.argv.slice(2), stdin))
    .then((out) => {
      process.stdout.write(`${out}\n`);
      process.exit(0);
    })
    .catch((err) => {
      process.stderr.write(`approve-hook: ${err instanceof Error ? err.message : String(err)}\n`);
      // Explicit deny: a remote-only run must never fall through to an in-TUI prompt.
      process.stdout.write(`${decisionJson('deny', 'approval hook error')}\n`);
      process.exit(0);
    });
}
