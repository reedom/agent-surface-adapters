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
 * True when the Bash command is the agent's own agentbus reporting to nagiInstance.
 * Matched tightly (the agentbus binary as a command word, a reporting verb, the
 * recipient) so the approval gate is not widened to arbitrary commands.
 */
export function isSelfReport(toolName: string, toolInput: unknown, nagiInstance: string): boolean {
  if (toolName !== 'Bash') return false;
  const command = (toolInput as { command?: unknown })?.command;
  if (typeof command !== 'string') return false;
  // `agentbus <verb> ...` where agentbus starts a command segment (start, or after | ; && ).
  const re = new RegExp(
    String.raw`(^|[|;&]\s*)agentbus\s+(send|reply|publish)\b([^|;&]*)`,
  );
  const m = command.match(re);
  if (!m) return false;
  if (m[2] === 'publish') return true; // broadcast: no recipient arg
  if (m[2] === 'reply') return new RegExp(String.raw`\b${nagiInstance}\b`).test(m[3] ?? '');
  // send <to>: the recipient is the first non-flag token after `send`
  const rest = (m[3] ?? '').trim().split(/\s+/);
  return rest[0] === nagiInstance;
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
