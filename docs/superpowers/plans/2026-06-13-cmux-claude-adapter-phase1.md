# cmux-claude-adapter Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `cmux-claude-adapter` package — an `ai-workflow-engine` `CliAdapter` that launches interactive `claude` (no `-p`) on a fresh cmux surface, routes tool approvals through agentbus, and returns an `AgentResult` on an explicit agentbus result message — proven end-to-end by a real cmux + agentbus smoke script. No nagi changes in this phase.

**Architecture:** The adapter is a thin orchestrator over injectable seams (`launchSurface`, `awaitResult`, `readUsage`). On `run(spec)` it writes a persistent per-run settings/meta dir (the surface outlives `run()`, so files must not be deleted), generates a launcher shell script (only the script *path* crosses the terminal — agent data flows over agentbus), launches a cmux workspace running that script, then blocks on an injected `awaitResult(runId)` resolved by the single agentbus consumer. Tool approvals use a Claude `PreToolUse` hook that does `agentbus ask nagi` and maps the reply to Claude's permission decision. A reusable consumer module drains the `nagi` inbox once and dispatches `ask`/progress/result; the smoke is the single consumer for Phase 1 (nagi takes that role in Phase 2).

**Tech Stack:** TypeScript (ESM, NodeNext), pnpm, vitest, Node 22. Depends on `ai-workflow-engine` (types only) and the `claude`, `cmux`, `agentbus` CLIs at runtime.

---

## Execution prerequisites

- All work happens in `/Users/tohru/Documents/src/ghq/github.com/reedom/cmux-claude-adapter`. **Run every command with the working directory set to that repo**, on a feature branch (e.g. `design/cmux-surfaced-agents`, already created). A user `block-on-main` git hook evaluates the *session* repo's branch; keep this repo's cwd active and on a non-`main`/non-`master` branch so commits are allowed.
- The design spec is at `docs/superpowers/specs/2026-06-13-cmux-surfaced-agents-design.md`.
- Smoke (Task 12) needs the real `claude`, `cmux` (app running, `CMUX_SOCKET_PATH` reachable), and `agentbus` CLIs installed and on `PATH`. Unit tests need none of these.

## File structure

```
cmux-claude-adapter/
  package.json              # Task 0
  tsconfig.json             # Task 0
  vitest.config.ts          # Task 0
  .gitignore                # Task 0
  src/
    run.ts                  # Task 1  RunFn + runProcess (child_process, optional stdin)
    prompt.ts               # Task 2  agentbusDirective + composeSystemPrompt
    command.ts              # Task 3  buildClaudeArgs + shellQuote + launcherScript
    settings.ts             # Task 4  writeApprovalSettings + hookTimeoutSeconds
    agentbus.ts             # Task 5  askApproval/parseAskReply/register/awaitInbox/reply/send
    hook/
      approve-via-agentbus.ts  # Task 6  runApprovalHook (PreToolUse hook helper) + CLI entry
    consumer.ts             # Task 7  consumeOnce + startConsumer (the single nagi consumer)
    launch.ts               # Task 8  launchSurface (cmux new-workspace --json)
    result.ts               # Task 9  findTranscript + readUsage (transcript JSONL)
    adapter.ts              # Task 10 makeCmuxClaudeAdapter (CliAdapter)
    index.ts                # Task 11 barrel exports
    smoke.ts                # Task 12 real cmux+agentbus smoke (built to dist/smoke.js)
  test/
    prompt.test.ts          # Task 2
    command.test.ts         # Task 3
    settings.test.ts        # Task 4
    agentbus.test.ts        # Task 5
    hook.test.ts            # Task 6
    consumer.test.ts        # Task 7
    launch.test.ts          # Task 8
    result.test.ts          # Task 9
    adapter.test.ts         # Task 10
  README.md                 # Task 13
```

---

## Task 0: Scaffold the package

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `src/index.ts`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "cmux-claude-adapter",
  "version": "0.1.0",
  "description": "ai-workflow-engine CliAdapter that runs interactive claude on a cmux surface, wired to agentbus",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "smoke": "pnpm build && node dist/smoke.js"
  },
  "dependencies": {
    "ai-workflow-engine": "file:../ai-workflow-engine"
  },
  "devDependencies": {
    "@types/node": "^22.7.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "rootDir": "src",
    "outDir": "dist",
    "declaration": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['test/**/*.test.ts'] },
});
```

- [ ] **Step 4: Create `.gitignore`**

```
node_modules/
dist/
```

- [ ] **Step 5: Create a placeholder `src/index.ts`** (replaced in Task 11)

```ts
export {};
```

- [ ] **Step 6: Install dependencies**

Run: `pnpm install`
Expected: completes; `ai-workflow-engine` linked from `../ai-workflow-engine`. If the engine is not built, run `pnpm --dir ../ai-workflow-engine build` first.

- [ ] **Step 7: Verify the toolchain**

Run: `pnpm typecheck && pnpm test`
Expected: typecheck passes; vitest reports "no test files found" (exit 0) — acceptable at this stage.

- [ ] **Step 8: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts .gitignore src/index.ts
git commit -m "chore: scaffold cmux-claude-adapter package"
```

---

## Task 1: Process runner (`run.ts`)

**Files:**
- Create: `src/run.ts`

A single child-process runner used by every CLI wrapper. Supports optional stdin (for `agentbus send`/`reply`/`ask` payloads piped in). No test of its own — it is the injection seam exercised through the wrappers; a smoke-only dependency. (Covered indirectly by Tasks 5/8.)

- [ ] **Step 1: Write `src/run.ts`**

```ts
import { spawn } from 'node:child_process';

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface RunOpts {
  cwd?: string;
  /** When set, written to the child's stdin and stdin is then closed. */
  input?: string;
}

export type RunFn = (cmd: string, args: string[], opts?: RunOpts) => Promise<RunResult>;

export const runProcess: RunFn = (cmd, args, opts) =>
  new Promise((resolve, reject) => {
    const useStdin = opts?.input !== undefined;
    const child = spawn(cmd, args, {
      cwd: opts?.cwd,
      stdio: [useStdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => {
      stdout += d;
    });
    child.stderr?.on('data', (d) => {
      stderr += d;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ stdout, stderr, code: code ?? -1 }));
    if (useStdin && child.stdin) {
      child.stdin.write(opts!.input!);
      child.stdin.end();
    }
  });
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/run.ts
git commit -m "feat: add process runner with optional stdin"
```

---

## Task 2: Prompt composition (`prompt.ts`)

**Files:**
- Create: `src/prompt.ts`
- Test: `test/prompt.test.ts`

`agentbusDirective` is the appended system prompt that teaches the launched claude exactly how to report over agentbus. `composeSystemPrompt` joins any caller `instructions` with the directive.

- [ ] **Step 1: Write the failing test `test/prompt.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { agentbusDirective, composeSystemPrompt } from '../src/prompt.js';

describe('agentbusDirective', () => {
  it('embeds the runId, recipient, and both message shapes', () => {
    const d = agentbusDirective('run-42', 'nagi');
    expect(d).toContain('run-42');
    expect(d).toContain('ext:awe-run-42');
    expect(d).toContain('agentbus send nagi');
    expect(d).toContain('"type":"progress"');
    expect(d).toContain('"type":"result"');
  });
});

describe('composeSystemPrompt', () => {
  it('returns the directive alone when no instructions', () => {
    expect(composeSystemPrompt(undefined, 'DIR')).toBe('DIR');
  });
  it('prefixes caller instructions before the directive', () => {
    expect(composeSystemPrompt('INST', 'DIR')).toBe('INST\n\nDIR');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/prompt.test.ts`
Expected: FAIL — cannot find module `../src/prompt.js`.

- [ ] **Step 3: Write `src/prompt.ts`**

```ts
export function agentbusDirective(runId: string, nagiInstance: string): string {
  const from = `ext:awe-${runId}`;
  return [
    `You are running as an agent under nagi, runId "${runId}".`,
    `Report progress and your final result over the agentbus message bus using the agentbus CLI.`,
    `Send progress at meaningful milestones (zero or more times):`,
    `  printf '%s' '{"type":"progress","runId":"${runId}","text":"<short status>"}' | agentbus send ${nagiInstance} --from ${from}`,
    `When the task is fully complete, send EXACTLY ONE result message:`,
    `  printf '%s' '{"type":"result","runId":"${runId}","text":"<your final answer>"}' | agentbus send ${nagiInstance} --from ${from}`,
    `Tool approvals are handled automatically by the harness; just proceed with your work.`,
  ].join('\n');
}

export function composeSystemPrompt(instructions: string | undefined, directive: string): string {
  return instructions ? `${instructions}\n\n${directive}` : directive;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/prompt.test.ts`
Expected: PASS (5 assertions).

- [ ] **Step 5: Commit**

```bash
git add src/prompt.ts test/prompt.test.ts
git commit -m "feat: add agentbus reporting directive and system-prompt composition"
```

---

## Task 3: Claude command + launcher script (`command.ts`)

**Files:**
- Create: `src/command.ts`
- Test: `test/command.test.ts`

Builds the interactive `claude` argument vector (no `-p`), a POSIX shell-quoter, and a launcher shell script. The launcher script is what cmux runs, so the prompt is embedded safely in the script and never typed through the terminal.

- [ ] **Step 1: Write the failing test `test/command.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { buildClaudeArgs, launcherScript, shellQuote } from '../src/command.js';

describe('buildClaudeArgs', () => {
  it('builds interactive args with session, settings, system prompt and prompt', () => {
    const args = buildClaudeArgs({
      sessionId: 'sess-1',
      settingsFile: '/run/settings.json',
      systemPrompt: 'SYS',
      prompt: 'do the thing',
    });
    expect(args).toContain('--session-id');
    expect(args).toContain('sess-1');
    expect(args).toContain('--settings');
    expect(args).toContain('/run/settings.json');
    expect(args).toContain('--append-system-prompt');
    expect(args).not.toContain('-p');
    expect(args[args.length - 2]).toBe('--');
    expect(args[args.length - 1]).toBe('do the thing');
  });

  it('adds model and add-dir only when provided', () => {
    const withExtras = buildClaudeArgs({
      sessionId: 's', settingsFile: 'f', systemPrompt: 'y', prompt: 'p',
      model: 'opus', addDir: '/repo',
    });
    expect(withExtras).toContain('--model');
    expect(withExtras).toContain('opus');
    expect(withExtras).toContain('--add-dir');
    expect(withExtras).toContain('/repo');
    const without = buildClaudeArgs({ sessionId: 's', settingsFile: 'f', systemPrompt: 'y', prompt: 'p' });
    expect(without).not.toContain('--model');
    expect(without).not.toContain('--add-dir');
  });
});

describe('shellQuote', () => {
  it('single-quotes and escapes embedded single quotes', () => {
    expect(shellQuote("a b")).toBe("'a b'");
    expect(shellQuote("it's")).toBe("'it'\\''s'");
  });
});

describe('launcherScript', () => {
  it('produces a bash exec line with every arg quoted', () => {
    const s = launcherScript('claude', ['--session-id', 's', '--', "it's done"]);
    expect(s.startsWith('#!/usr/bin/env bash\n')).toBe(true);
    expect(s).toContain("exec 'claude' '--session-id' 's' '--' 'it'\\''s done'");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/command.test.ts`
Expected: FAIL — cannot find module `../src/command.js`.

- [ ] **Step 3: Write `src/command.ts`**

```ts
export interface ClaudeArgsInput {
  sessionId: string;
  settingsFile: string;
  systemPrompt: string;
  prompt: string;
  model?: string;
  addDir?: string;
}

export function buildClaudeArgs(input: ClaudeArgsInput): string[] {
  const args = [
    '--session-id', input.sessionId,
    '--settings', input.settingsFile,
    '--append-system-prompt', input.systemPrompt,
  ];
  if (input.model) args.push('--model', input.model);
  if (input.addDir) args.push('--add-dir', input.addDir);
  args.push('--', input.prompt);
  return args;
}

export function shellQuote(arg: string): string {
  return `'${arg.split("'").join(`'\\''`)}'`;
}

export function launcherScript(bin: string, args: string[]): string {
  const line = [bin, ...args].map(shellQuote).join(' ');
  return `#!/usr/bin/env bash\nexec ${line}\n`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/command.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/command.ts test/command.test.ts
git commit -m "feat: add interactive claude arg builder and launcher script"
```

---

## Task 4: Approval settings + meta (`settings.ts`)

**Files:**
- Create: `src/settings.ts`
- Test: `test/settings.test.ts`

Writes a persistent per-run `meta.json` (read by the hook) and a Claude `settings.json` installing the `PreToolUse` approval hook. Reuses the engine's settings shape and timeout rule.

- [ ] **Step 1: Write the failing test `test/settings.test.ts`**

```ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hookTimeoutSeconds, writeApprovalSettings } from '../src/settings.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'set-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('hookTimeoutSeconds', () => {
  it('returns 86400 for wait', () => {
    expect(hookTimeoutSeconds({ timeoutMs: 1000, onTimeout: 'wait' })).toBe(86_400);
  });
  it('returns ceil(timeoutMs/1000)+60 for deny', () => {
    expect(hookTimeoutSeconds({ timeoutMs: 5500, onTimeout: 'deny' })).toBe(66);
  });
});

describe('writeApprovalSettings', () => {
  it('writes meta.json with the wait timeout and settings.json with the hook command', () => {
    const settingsPath = writeApprovalSettings({
      runDir: dir, runId: 'run-7', nagiInstance: 'nagi',
      policy: { timeoutMs: 1000, onTimeout: 'wait' },
      hookCommand: '"/usr/bin/node" "/pkg/dist/hook/approve-via-agentbus.js"',
    });
    const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
    expect(meta).toEqual({ runId: 'run-7', nagiInstance: 'nagi', timeoutMs: 86_400_000 });

    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    const hook = settings.hooks.PreToolUse[0].hooks[0];
    expect(settings.hooks.PreToolUse[0].matcher).toBe('*');
    expect(hook.type).toBe('command');
    expect(hook.timeout).toBe(86_400);
    expect(hook.command).toContain('approve-via-agentbus.js');
    expect(hook.command).toContain(`--meta "${join(dir, 'meta.json')}"`);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/settings.test.ts`
Expected: FAIL — cannot find module `../src/settings.js`.

- [ ] **Step 3: Write `src/settings.ts`**

```ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EscalationPolicy } from 'ai-workflow-engine';

export interface ApprovalSettingsInput {
  runDir: string;
  runId: string;
  nagiInstance: string;
  policy: EscalationPolicy;
  /** Full command prefix for the PreToolUse hook; `--meta <path>` is appended. */
  hookCommand: string;
}

export function hookTimeoutSeconds(policy: EscalationPolicy): number {
  if (policy.onTimeout === 'wait') return 86_400;
  return Math.ceil(policy.timeoutMs / 1000) + 60;
}

export function writeApprovalSettings(input: ApprovalSettingsInput): string {
  mkdirSync(input.runDir, { recursive: true });
  const metaPath = join(input.runDir, 'meta.json');
  writeFileSync(
    metaPath,
    JSON.stringify({
      runId: input.runId,
      nagiInstance: input.nagiInstance,
      timeoutMs: input.policy.onTimeout === 'wait' ? 86_400_000 : input.policy.timeoutMs,
    }),
  );
  const settings = {
    hooks: {
      PreToolUse: [
        {
          matcher: '*',
          hooks: [
            {
              type: 'command',
              command: `${input.hookCommand} --meta "${metaPath}"`,
              timeout: hookTimeoutSeconds(input.policy),
            },
          ],
        },
      ],
    },
  };
  const settingsPath = join(input.runDir, 'settings.json');
  writeFileSync(settingsPath, JSON.stringify(settings));
  return settingsPath;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/settings.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/settings.ts test/settings.test.ts
git commit -m "feat: write per-run claude approval settings and meta"
```

---

## Task 5: agentbus CLI wrappers (`agentbus.ts`)

**Files:**
- Create: `src/agentbus.ts`
- Test: `test/agentbus.test.ts`

Thin, injectable wrappers over the `agentbus` CLI. `parseAskReply` mirrors the engine's contract: the reply envelope's `payload.behavior` decides allow/deny.

- [ ] **Step 1: Write the failing test `test/agentbus.test.ts`**

```ts
import { describe, expect, it, vi } from 'vitest';
import { askApproval, awaitInbox, parseAskReply, register, reply, send } from '../src/agentbus.js';
import type { RunFn } from '../src/run.js';

const ok = (stdout = '') => ({ stdout, stderr: '', code: 0 });

describe('parseAskReply', () => {
  it('reads allow from the reply envelope payload', () => {
    expect(parseAskReply('{"payload":{"behavior":"allow","reason":"ok"}}')).toEqual({ behavior: 'allow', reason: 'ok' });
  });
  it('treats anything else as deny', () => {
    expect(parseAskReply('{"payload":{"behavior":"deny"}}')).toEqual({ behavior: 'deny', reason: 'denied' });
    expect(parseAskReply('not json')).toEqual({ behavior: 'deny', reason: 'unparseable reply' });
  });
});

describe('askApproval', () => {
  it('invokes `agentbus ask` with from/timeout and pipes the payload', async () => {
    const runner = vi.fn<RunFn>().mockResolvedValue(ok('{"payload":{"behavior":"allow"}}'));
    const decision = await askApproval('nagi', 'ext:awe-1', 86_400_000, { type: 'approval', runId: '1' }, { runner });
    expect(decision.behavior).toBe('allow');
    const [cmd, args, opts] = runner.mock.calls[0];
    expect(cmd).toBe('agentbus');
    expect(args.slice(0, 2)).toEqual(['ask', 'nagi']);
    expect(args).toContain('--from');
    expect(args).toContain('ext:awe-1');
    expect(args).toContain('--timeout-ms');
    expect(args).toContain('86400000');
    expect(JSON.parse(opts!.input!)).toEqual({ type: 'approval', runId: '1' });
  });
  it('denies when the CLI exits non-zero', async () => {
    const runner = vi.fn<RunFn>().mockResolvedValue({ stdout: '', stderr: 'boom', code: 2 });
    expect((await askApproval('nagi', 'f', 1, {}, { runner })).behavior).toBe('deny');
  });
});

describe('awaitInbox', () => {
  it('returns the envelopes array', async () => {
    const runner = vi.fn<RunFn>().mockResolvedValue(ok('{"envelopes":[{"id":"a","kind":"message","from":"x","payload":{"type":"progress"}}]}'));
    const envs = await awaitInbox('nagi', 1000, { runner });
    expect(envs).toHaveLength(1);
    expect(envs[0].payload.type).toBe('progress');
    expect(runner.mock.calls[0][1]).toEqual(['await', 'nagi', '--timeout-ms', '1000']);
  });
  it('returns [] on non-zero exit', async () => {
    const runner = vi.fn<RunFn>().mockResolvedValue({ stdout: '', stderr: '', code: 1 });
    expect(await awaitInbox('nagi', 1, { runner })).toEqual([]);
  });
});

describe('send / reply / register', () => {
  it('send pipes payload to `agentbus send`', async () => {
    const runner = vi.fn<RunFn>().mockResolvedValue(ok());
    await send('nagi', 'ext:awe-1', { type: 'result', text: 'done' }, { runner });
    const [cmd, args, opts] = runner.mock.calls[0];
    expect([cmd, args.slice(0, 2)]).toEqual(['agentbus', ['send', 'nagi']]);
    expect(JSON.parse(opts!.input!)).toEqual({ type: 'result', text: 'done' });
  });
  it('reply targets the ask id and the answerer instance', async () => {
    const runner = vi.fn<RunFn>().mockResolvedValue(ok());
    await reply('ask-9', 'nagi', { behavior: 'allow' }, { runner });
    expect(runner.mock.calls[0][1].slice(0, 3)).toEqual(['reply', 'ask-9', 'nagi']);
  });
  it('register passes --persistent', async () => {
    const runner = vi.fn<RunFn>().mockResolvedValue(ok());
    await register('nagi', { persistent: true, runner });
    expect(runner.mock.calls[0][1]).toEqual(['register', 'nagi', '--persistent']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/agentbus.test.ts`
Expected: FAIL — cannot find module `../src/agentbus.js`.

- [ ] **Step 3: Write `src/agentbus.ts`**

```ts
import { runProcess, type RunFn } from './run.js';

export interface Envelope {
  id: string;
  kind: string;
  from: string;
  to?: string;
  payload: { type?: string; [k: string]: unknown };
}

export interface Decision {
  behavior: 'allow' | 'deny';
  reason?: string;
}

export interface AgentbusOpts {
  bin?: string;
  runner?: RunFn;
}

function bin(opts: AgentbusOpts): string {
  return opts.bin ?? 'agentbus';
}
function runner(opts: AgentbusOpts): RunFn {
  return opts.runner ?? runProcess;
}

export function parseAskReply(stdout: string): Decision {
  try {
    const env = JSON.parse(stdout) as { payload?: { behavior?: string; reason?: string } };
    const reply = env.payload ?? {};
    const reason = typeof reply.reason === 'string' ? reply.reason : undefined;
    if (reply.behavior === 'allow') return { behavior: 'allow', reason };
    return { behavior: 'deny', reason: reason ?? 'denied' };
  } catch {
    return { behavior: 'deny', reason: 'unparseable reply' };
  }
}

export async function askApproval(
  to: string,
  from: string,
  timeoutMs: number,
  payload: unknown,
  opts: AgentbusOpts = {},
): Promise<Decision> {
  const r = await runner(opts)(
    bin(opts),
    ['ask', to, '--from', from, '--timeout-ms', String(timeoutMs)],
    { input: JSON.stringify(payload) },
  );
  if (r.code !== 0) return { behavior: 'deny', reason: `ask failed: ${r.stderr.trim().slice(0, 200)}` };
  return parseAskReply(r.stdout);
}

export async function awaitInbox(id: string, timeoutMs: number, opts: AgentbusOpts = {}): Promise<Envelope[]> {
  const r = await runner(opts)(bin(opts), ['await', id, '--timeout-ms', String(timeoutMs)]);
  if (r.code !== 0) return [];
  try {
    return (JSON.parse(r.stdout).envelopes ?? []) as Envelope[];
  } catch {
    return [];
  }
}

export async function send(to: string, from: string, payload: unknown, opts: AgentbusOpts = {}): Promise<void> {
  const r = await runner(opts)(bin(opts), ['send', to, '--from', from], { input: JSON.stringify(payload) });
  if (r.code !== 0) throw new Error(`agentbus send failed: ${r.stderr.trim().slice(0, 200)}`);
}

export async function reply(askId: string, from: string, payload: unknown, opts: AgentbusOpts = {}): Promise<void> {
  const r = await runner(opts)(bin(opts), ['reply', askId, from], { input: JSON.stringify(payload) });
  if (r.code !== 0) throw new Error(`agentbus reply failed: ${r.stderr.trim().slice(0, 200)}`);
}

export async function register(
  id: string,
  opts: AgentbusOpts & { persistent?: boolean; pid?: number } = {},
): Promise<void> {
  const args = ['register', id];
  if (opts.persistent) args.push('--persistent');
  if (opts.pid !== undefined) args.push('--pid', String(opts.pid));
  const r = await runner(opts)(bin(opts), args);
  if (r.code !== 0) throw new Error(`agentbus register failed: ${r.stderr.trim().slice(0, 200)}`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/agentbus.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agentbus.ts test/agentbus.test.ts
git commit -m "feat: add agentbus cli wrappers (ask/await/send/reply/register)"
```

---

## Task 6: Approval hook helper (`hook/approve-via-agentbus.ts`)

**Files:**
- Create: `src/hook/approve-via-agentbus.ts`
- Test: `test/hook.test.ts`

The Claude `PreToolUse` hook. Reads the hook event from stdin, the run meta from `--meta`, issues `agentbus ask nagi`, and emits Claude's permission-decision JSON. Pure `runApprovalHook` is unit-tested with a fake `ask`; the CLI entry wires stdin/stdout and denies on error (so a remote-only run never stalls on an in-TUI prompt).

- [ ] **Step 1: Write the failing test `test/hook.test.ts`**

```ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runApprovalHook } from '../src/hook/approve-via-agentbus.js';

let dir: string;
let metaPath: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hook-'));
  metaPath = join(dir, 'meta.json');
  writeFileSync(metaPath, JSON.stringify({ runId: 'run-3', nagiInstance: 'nagi', timeoutMs: 86_400_000 }));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const hookStdin = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' }, cwd: '/repo' });

describe('runApprovalHook', () => {
  it('asks nagi and maps allow to a PreToolUse allow decision', async () => {
    const ask = vi.fn().mockResolvedValue({ behavior: 'allow', reason: 'ok' });
    const out = JSON.parse(await runApprovalHook(['--meta', metaPath], hookStdin, { ask }));
    expect(out.hookSpecificOutput.hookEventName).toBe('PreToolUse');
    expect(out.hookSpecificOutput.permissionDecision).toBe('allow');
    const [to, from, timeoutMs, payload] = ask.mock.calls[0];
    expect(to).toBe('nagi');
    expect(from).toBe('ext:awe-run-3');
    expect(timeoutMs).toBe(86_400_000);
    expect(payload).toEqual({ type: 'approval', runId: 'run-3', tool: 'Bash', input: { command: 'ls' }, cwd: '/repo' });
  });

  it('maps deny to a PreToolUse deny decision', async () => {
    const ask = vi.fn().mockResolvedValue({ behavior: 'deny', reason: 'nope' });
    const out = JSON.parse(await runApprovalHook(['--meta', metaPath], hookStdin, { ask }));
    expect(out.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(out.hookSpecificOutput.permissionDecisionReason).toBe('nope');
  });

  it('throws when --meta is missing', async () => {
    await expect(runApprovalHook([], hookStdin, { ask: vi.fn() })).rejects.toThrow(/--meta/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/hook.test.ts`
Expected: FAIL — cannot find module `../src/hook/approve-via-agentbus.js`.

- [ ] **Step 3: Write `src/hook/approve-via-agentbus.ts`**

```ts
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { askApproval, type Decision } from '../agentbus.js';

type AskFn = (to: string, from: string, timeoutMs: number, payload: unknown) => Promise<Decision>;

export interface HookDeps {
  ask?: AskFn;
}

function takeArg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  if (i < 0) return undefined;
  return argv[i + 1];
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/hook.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hook/approve-via-agentbus.ts test/hook.test.ts
git commit -m "feat: add PreToolUse approval hook over agentbus ask"
```

---

## Task 7: Single nagi consumer (`consumer.ts`)

**Files:**
- Create: `src/consumer.ts`
- Test: `test/consumer.test.ts`

The single drainer of the `nagi` inbox. `consumeOnce` drains one batch and dispatches by kind/type, replying to approval asks. `startConsumer` loops it. Both the smoke (Phase 1) and nagi (Phase 2) use this so there is exactly one inbox consumer.

- [ ] **Step 1: Write the failing test `test/consumer.test.ts`**

```ts
import { describe, expect, it, vi } from 'vitest';
import { consumeOnce } from '../src/consumer.js';
import type { RunFn } from '../src/run.js';

function runnerYielding(envelopes: unknown[]): RunFn {
  return vi.fn<RunFn>(async (_cmd, args) => {
    if (args[0] === 'await') return { stdout: JSON.stringify({ envelopes }), stderr: '', code: 0 };
    return { stdout: '', stderr: '', code: 0 }; // reply
  });
}

describe('consumeOnce', () => {
  it('replies to an approval ask with the handler decision', async () => {
    const runner = runnerYielding([
      { id: 'ask-1', kind: 'ask', from: 'ext:awe-1', payload: { type: 'approval', runId: '1', tool: 'Bash' } },
    ]);
    const onApproval = vi.fn().mockResolvedValue({ behavior: 'allow' });
    await consumeOnce('nagi', 1000, { onApproval, onProgress: vi.fn(), onResult: vi.fn() }, { runner });
    expect(onApproval).toHaveBeenCalledOnce();
    const replyCall = (runner as any).mock.calls.find((c: any[]) => c[1][0] === 'reply');
    expect(replyCall[1].slice(0, 3)).toEqual(['reply', 'ask-1', 'nagi']);
    expect(JSON.parse(replyCall[2].input)).toEqual({ behavior: 'allow' });
  });

  it('dispatches progress and result messages without replying', async () => {
    const runner = runnerYielding([
      { id: 'm1', kind: 'message', from: 'ext:awe-1', payload: { type: 'progress', runId: '1', text: 'step' } },
      { id: 'm2', kind: 'message', from: 'ext:awe-1', payload: { type: 'result', runId: '1', text: 'done' } },
    ]);
    const onProgress = vi.fn();
    const onResult = vi.fn();
    await consumeOnce('nagi', 1000, { onApproval: vi.fn(), onProgress, onResult }, { runner });
    expect(onProgress).toHaveBeenCalledOnce();
    expect(onResult).toHaveBeenCalledOnce();
    expect((onResult.mock.calls[0][0] as any).payload.text).toBe('done');
    expect((runner as any).mock.calls.some((c: any[]) => c[1][0] === 'reply')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/consumer.test.ts`
Expected: FAIL — cannot find module `../src/consumer.js`.

- [ ] **Step 3: Write `src/consumer.ts`**

```ts
import { awaitInbox, reply, type AgentbusOpts, type Decision, type Envelope } from './agentbus.js';

export interface ConsumerHandlers {
  onApproval: (env: Envelope) => Promise<Decision>;
  onProgress: (env: Envelope) => void;
  onResult: (env: Envelope) => void;
}

export async function consumeOnce(
  instance: string,
  timeoutMs: number,
  handlers: ConsumerHandlers,
  opts: AgentbusOpts = {},
): Promise<void> {
  const envelopes = await awaitInbox(instance, timeoutMs, opts);
  for (const env of envelopes) {
    const type = env.payload?.type;
    if (env.kind === 'ask' && type === 'approval') {
      const decision = await handlers.onApproval(env);
      await reply(env.id, instance, decision, opts);
    } else if (type === 'progress') {
      handlers.onProgress(env);
    } else if (type === 'result') {
      handlers.onResult(env);
    }
  }
}

export interface ConsumerLoop {
  stop: () => void;
}

export function startConsumer(
  instance: string,
  handlers: ConsumerHandlers,
  opts: AgentbusOpts & { intervalMs?: number } = {},
): ConsumerLoop {
  let running = true;
  const loop = async () => {
    while (running) {
      try {
        await consumeOnce(instance, opts.intervalMs ?? 2000, handlers, opts);
      } catch {
        // keep looping; transient agentbus errors must not kill the consumer
      }
    }
  };
  void loop();
  return { stop: () => { running = false; } };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/consumer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/consumer.ts test/consumer.test.ts
git commit -m "feat: add single nagi inbox consumer (approval/progress/result)"
```

---

## Task 8: Launch surface (`launch.ts`)

**Files:**
- Create: `src/launch.ts`
- Test: `test/launch.test.ts`

Default `launchSurface`: `cmux new-workspace --cwd <cwd> --command <command> --json`. Parses the JSON for a surface/workspace ref; tolerates ref-text output.

- [ ] **Step 1: Write the failing test `test/launch.test.ts`**

```ts
import { describe, expect, it, vi } from 'vitest';
import { launchSurface } from '../src/launch.js';
import type { RunFn } from '../src/run.js';

describe('launchSurface', () => {
  it('calls cmux new-workspace with cwd, command and --json, returning a ref', async () => {
    const runner = vi.fn<RunFn>().mockResolvedValue({ stdout: '{"surface":"surface:4"}', stderr: '', code: 0 });
    const ref = await launchSurface({ cwd: '/repo', command: 'bash /run/launch.sh', runner });
    expect(ref.ref).toBe('surface:4');
    const args = runner.mock.calls[0][1];
    expect(args[0]).toBe('new-workspace');
    expect(args).toContain('--cwd');
    expect(args).toContain('/repo');
    expect(args).toContain('--command');
    expect(args).toContain('bash /run/launch.sh');
    expect(args).toContain('--json');
  });

  it('throws on non-zero exit', async () => {
    const runner = vi.fn<RunFn>().mockResolvedValue({ stdout: '', stderr: 'no socket', code: 1 });
    await expect(launchSurface({ command: 'x', runner })).rejects.toThrow(/new-workspace failed/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/launch.test.ts`
Expected: FAIL — cannot find module `../src/launch.js`.

- [ ] **Step 3: Write `src/launch.ts`**

```ts
import { runProcess, type RunFn } from './run.js';

export interface LaunchInput {
  cwd?: string;
  command: string;
  runner?: RunFn;
  bin?: string;
}

export interface SurfaceRef {
  raw: string;
  ref?: string;
}

export async function launchSurface(input: LaunchInput): Promise<SurfaceRef> {
  const bin = input.bin ?? 'cmux';
  const run = input.runner ?? runProcess;
  const args = ['new-workspace'];
  if (input.cwd) args.push('--cwd', input.cwd);
  args.push('--command', input.command, '--json');
  const r = await run(bin, args);
  if (r.code !== 0) throw new Error(`cmux new-workspace failed: ${r.stderr.trim().slice(0, 300)}`);
  let ref: string | undefined;
  try {
    const j = JSON.parse(r.stdout) as Record<string, unknown>;
    const found = j.surface ?? j.workspace ?? j.id;
    ref = typeof found === 'string' ? found : undefined;
  } catch {
    // ref-text output (no --json support) is fine; keep raw only
  }
  return { raw: r.stdout.trim(), ref };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/launch.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/launch.ts test/launch.test.ts
git commit -m "feat: add cmux new-workspace surface launcher"
```

---

## Task 9: Transcript usage (`result.ts`)

**Files:**
- Create: `src/result.ts`
- Test: `test/result.test.ts`

Locates the session transcript JSONL by `sessionId` under `~/.claude/projects/*/` and reads the last assistant `message.usage`. Returns `null` when absent (caller falls back to zeros). Searching by filename avoids depending on the exact cwd→dir hashing.

- [ ] **Step 1: Write the failing test `test/result.test.ts`**

```ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findTranscript, readUsage } from '../src/result.js';

let base: string;
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'proj-'));
  const projectDir = join(base, '-repo-some-path');
  mkdirSync(projectDir, { recursive: true });
  const lines = [
    JSON.stringify({ type: 'user', message: { role: 'user' } }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', usage: { input_tokens: 10, output_tokens: 5 } } }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', usage: { input_tokens: 30, output_tokens: 12 } } }),
  ].join('\n');
  writeFileSync(join(projectDir, 'sess-abc.jsonl'), `${lines}\n`);
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

describe('findTranscript', () => {
  it('finds the transcript by session id under any project dir', () => {
    expect(findTranscript('sess-abc', { projectsDir: base })).toContain('sess-abc.jsonl');
  });
  it('returns null when missing', () => {
    expect(findTranscript('nope', { projectsDir: base })).toBeNull();
  });
});

describe('readUsage', () => {
  it('returns the last assistant usage', () => {
    expect(readUsage('sess-abc', { projectsDir: base })).toEqual({ inputTokens: 30, outputTokens: 12 });
  });
  it('returns null when no transcript', () => {
    expect(readUsage('nope', { projectsDir: base })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/result.test.ts`
Expected: FAIL — cannot find module `../src/result.js`.

- [ ] **Step 3: Write `src/result.ts`**

```ts
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface UsageDeps {
  projectsDir?: string;
}

export interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
}

function projectsBase(deps: UsageDeps): string {
  return deps.projectsDir ?? join(homedir(), '.claude', 'projects');
}

export function findTranscript(sessionId: string, deps: UsageDeps = {}): string | null {
  const base = projectsBase(deps);
  if (!existsSync(base)) return null;
  for (const dir of readdirSync(base)) {
    const candidate = join(base, dir, `${sessionId}.jsonl`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function readUsage(sessionId: string, deps: UsageDeps = {}): AgentUsage | null {
  const file = findTranscript(sessionId, deps);
  if (!file) return null;
  const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
  for (let i = lines.length - 1; 0 <= i; i--) {
    try {
      const event = JSON.parse(lines[i]) as { message?: { usage?: { input_tokens?: number; output_tokens?: number } } };
      const usage = event.message?.usage;
      if (usage && (usage.input_tokens !== undefined || usage.output_tokens !== undefined)) {
        return { inputTokens: Number(usage.input_tokens ?? 0), outputTokens: Number(usage.output_tokens ?? 0) };
      }
    } catch {
      // skip malformed lines
    }
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/result.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/result.ts test/result.test.ts
git commit -m "feat: read agent token usage from claude session transcript"
```

---

## Task 10: The adapter (`adapter.ts`)

**Files:**
- Create: `src/adapter.ts`
- Test: `test/adapter.test.ts`

Wires the seams into a `CliAdapter`. Writes a persistent run dir (NOT deleted — the surface outlives `run()`), the launcher script, launches the surface, awaits the injected result, reads usage, and returns an `AgentResult`.

- [ ] **Step 1: Write the failing test `test/adapter.test.ts`**

```ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentSpec } from 'ai-workflow-engine';
import { makeCmuxClaudeAdapter } from '../src/adapter.js';
import type { LaunchInput, SurfaceRef } from '../src/launch.js';

let runsDir: string;
beforeEach(() => { runsDir = mkdtempSync(join(tmpdir(), 'runs-')); });
afterEach(() => rmSync(runsDir, { recursive: true, force: true }));

function spec(over: Partial<AgentSpec> = {}): AgentSpec {
  return { prompt: 'do the thing', cwd: '/repo', ...over };
}

describe('makeCmuxClaudeAdapter', () => {
  it('exposes the cmux id and non-schema caps', () => {
    const adapter = makeCmuxClaudeAdapter({ awaitResult: async () => ({ text: '' }) });
    expect(adapter.id).toBe('cmux');
    expect(adapter.caps).toEqual({ schema: false, resume: false, tools: true });
  });

  it('launches a surface running the per-run launcher and returns the awaited result + usage', async () => {
    let launched: LaunchInput | undefined;
    const launchSurface = vi.fn(async (input: LaunchInput): Promise<SurfaceRef> => {
      launched = input;
      return { raw: '{"surface":"surface:1"}', ref: 'surface:1' };
    });
    const awaitResult = vi.fn(async (_runId: string) => ({ text: 'final answer' }));
    const readUsage = vi.fn(() => ({ inputTokens: 7, outputTokens: 3 }));

    const adapter = makeCmuxClaudeAdapter({
      awaitResult, launchSurface, readUsage, runsDir,
      hookHelperPath: '/pkg/dist/hook/approve-via-agentbus.js',
      newRunId: () => 'run-1', newSessionId: () => 'sess-1',
    });

    const result = await adapter.run(spec());

    expect(result.text).toBe('final answer');
    expect(result.usage).toEqual({ inputTokens: 7, outputTokens: 3 });
    expect(result.sessionId).toBe('sess-1');
    expect(awaitResult).toHaveBeenCalledWith('run-1');

    // launches `bash <runDir>/launch.sh`, cwd from spec
    expect(launched?.cwd).toBe('/repo');
    expect(launched?.command).toMatch(/^bash '.*run-1\/launch\.sh'$/);

    // persistent run dir: settings + launcher exist after run() resolves
    const runDir = join(runsDir, 'run-1');
    expect(existsSync(join(runDir, 'settings.json'))).toBe(true);
    expect(existsSync(join(runDir, 'meta.json'))).toBe(true);
    const launchScript = readFileSync(join(runDir, 'launch.sh'), 'utf8');
    expect(launchScript).toContain('--session-id');
    expect(launchScript).toContain('sess-1');
    expect(launchScript).toContain('--settings');
    expect(launchScript).not.toContain('-p ');
  });

  it('falls back to zero usage when no transcript is found', async () => {
    const adapter = makeCmuxClaudeAdapter({
      awaitResult: async () => ({ text: 'x' }),
      launchSurface: async () => ({ raw: '', ref: undefined }),
      readUsage: () => null,
      runsDir,
      newRunId: () => 'run-2', newSessionId: () => 'sess-2',
    });
    const result = await adapter.run(spec());
    expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/adapter.test.ts`
Expected: FAIL — cannot find module `../src/adapter.js`.

- [ ] **Step 3: Write `src/adapter.ts`**

```ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execPath } from 'node:process';
import { fileURLToPath } from 'node:url';
import type { AgentResult, AgentSpec, CliAdapter, EscalationPolicy } from 'ai-workflow-engine';
import { writeApprovalSettings } from './settings.js';
import { agentbusDirective, composeSystemPrompt } from './prompt.js';
import { buildClaudeArgs, launcherScript, shellQuote } from './command.js';
import { launchSurface as defaultLaunchSurface, type LaunchInput, type SurfaceRef } from './launch.js';
import { readUsage as defaultReadUsage, type AgentUsage } from './result.js';

const DEFAULT_POLICY: EscalationPolicy = { timeoutMs: 86_400_000, onTimeout: 'wait' };

export interface CmuxAdapterDeps {
  /** Resolved by the single nagi consumer when this run's result message arrives. REQUIRED. */
  awaitResult: (runId: string) => Promise<{ text: string }>;
  nagiInstance?: string;
  claudeBin?: string;
  /** Absolute path to the built hook helper (dist/hook/approve-via-agentbus.js). */
  hookHelperPath?: string;
  /** Persistent per-run dir root (default ~/.cmux-claude-adapter/runs). NOT cleaned up. */
  runsDir?: string;
  launchSurface?: (input: LaunchInput) => Promise<SurfaceRef>;
  readUsage?: (sessionId: string) => AgentUsage | null;
  newRunId?: () => string;
  newSessionId?: () => string;
}

export function makeCmuxClaudeAdapter(deps: CmuxAdapterDeps): CliAdapter {
  const nagiInstance = deps.nagiInstance ?? 'nagi';
  const claudeBin = deps.claudeBin ?? 'claude';
  const runsDir = deps.runsDir ?? join(homedir(), '.cmux-claude-adapter', 'runs');
  const launch = deps.launchSurface ?? defaultLaunchSurface;
  const readUsage = deps.readUsage ?? defaultReadUsage;
  const hookHelperPath =
    deps.hookHelperPath ?? fileURLToPath(new URL('./hook/approve-via-agentbus.js', import.meta.url));

  return {
    id: 'cmux',
    caps: { schema: false, resume: false, tools: true },
    async run(spec: AgentSpec): Promise<AgentResult> {
      const runId = spec.escalation?.runId ?? deps.newRunId?.() ?? randomUUID();
      const sessionId = deps.newSessionId?.() ?? randomUUID();
      const policy = spec.escalation?.policy ?? DEFAULT_POLICY;
      const runDir = join(runsDir, runId);
      mkdirSync(runDir, { recursive: true });

      const hookCommand = `"${execPath}" "${hookHelperPath}"`;
      const settingsFile = writeApprovalSettings({ runDir, runId, nagiInstance, policy, hookCommand });

      const systemPrompt = composeSystemPrompt(spec.instructions, agentbusDirective(runId, nagiInstance));
      const args = buildClaudeArgs({
        sessionId,
        settingsFile,
        systemPrompt,
        prompt: spec.prompt,
        model: spec.model,
        addDir: spec.cwd,
      });
      const scriptPath = join(runDir, 'launch.sh');
      writeFileSync(scriptPath, launcherScript(claudeBin, args));

      const surface = await launch({ cwd: spec.cwd, command: `bash ${shellQuote(scriptPath)}` });
      const result = await deps.awaitResult(runId);
      const usage = readUsage(sessionId) ?? { inputTokens: 0, outputTokens: 0 };

      return {
        text: result.text,
        raw: { surface, runId, sessionId },
        usage,
        sessionId,
      };
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/adapter.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `pnpm test`
Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/adapter.ts test/adapter.test.ts
git commit -m "feat: add cmux claude CliAdapter"
```

---

## Task 11: Barrel exports (`index.ts`)

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Replace `src/index.ts`**

```ts
export { makeCmuxClaudeAdapter } from './adapter.js';
export type { CmuxAdapterDeps } from './adapter.js';
export { startConsumer, consumeOnce } from './consumer.js';
export type { ConsumerHandlers, ConsumerLoop } from './consumer.js';
export { register, send, awaitInbox, reply, askApproval, parseAskReply } from './agentbus.js';
export type { Envelope, Decision, AgentbusOpts } from './agentbus.js';
export { launchSurface } from './launch.js';
export type { LaunchInput, SurfaceRef } from './launch.js';
export { readUsage, findTranscript } from './result.js';
export type { AgentUsage } from './result.js';
export { runProcess } from './run.js';
export type { RunFn, RunResult, RunOpts } from './run.js';
```

- [ ] **Step 2: Build the package**

Run: `pnpm build`
Expected: PASS; `dist/index.js`, `dist/adapter.js`, `dist/hook/approve-via-agentbus.js` all emitted.

- [ ] **Step 3: Verify the hook entry is runnable as a standalone process**

Run: `echo '{"tool_name":"Bash","tool_input":{"command":"ls"},"cwd":"/tmp"}' | node dist/hook/approve-via-agentbus.js`
Expected: exits 0 and prints a `deny` decision JSON (no `--meta` → the CLI entry's catch path emits the explicit deny). Confirms the built hook runs and fails safe.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: export public adapter and helper surface"
```

---

## Task 12: Real smoke script (`smoke.ts`)

**Files:**
- Create: `src/smoke.ts`

A standalone program (built to `dist/smoke.js`, run via `pnpm smoke`) that proves the full path against real `claude` + `cmux` + `agentbus`. It registers `nagi`, runs the single consumer (auto-allowing approvals and logging progress), runs the adapter, and prints the result. This is a manual integration check, not a vitest test.

- [ ] **Step 1: Write `src/smoke.ts`**

```ts
import { register } from './agentbus.js';
import { startConsumer } from './consumer.js';
import { makeCmuxClaudeAdapter } from './adapter.js';
import type { Envelope } from './agentbus.js';
import { fileURLToPath } from 'node:url';

// Usage: pnpm smoke "<task prompt>" [cwd]
async function main(): Promise<void> {
  const task = process.argv[2] ?? 'Run `pwd` with the Bash tool, then report the directory as your result.';
  const cwd = process.argv[3] ?? process.cwd();
  const nagiInstance = 'nagi';

  await register(nagiInstance, { persistent: true });

  // runId -> resolver for the awaited result
  const pending = new Map<string, (text: string) => void>();
  const consumer = startConsumer(
    nagiInstance,
    {
      onApproval: async (env: Envelope) => {
        console.log(`[approval] ${JSON.stringify(env.payload)} -> allow`);
        return { behavior: 'allow' };
      },
      onProgress: (env: Envelope) => console.log(`[progress] ${String(env.payload.text ?? '')}`),
      onResult: (env: Envelope) => {
        const runId = String(env.payload.runId ?? '');
        console.log(`[result] runId=${runId} text=${String(env.payload.text ?? '')}`);
        pending.get(runId)?.(String(env.payload.text ?? ''));
      },
    },
    { intervalMs: 1000 },
  );

  const hookHelperPath = fileURLToPath(new URL('./hook/approve-via-agentbus.js', import.meta.url));
  const adapter = makeCmuxClaudeAdapter({
    nagiInstance,
    hookHelperPath,
    awaitResult: (runId: string) =>
      new Promise<{ text: string }>((resolve) => pending.set(runId, (text) => resolve({ text }))),
  });

  console.log(`[smoke] launching surface for task: ${task}`);
  const result = await adapter.run({ prompt: task, cwd });
  console.log(`[smoke] adapter returned:`, JSON.stringify(result, null, 2));

  consumer.stop();
  process.exit(0);
}

main().catch((err) => {
  console.error('[smoke] failed:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Build**

Run: `pnpm build`
Expected: PASS; `dist/smoke.js` emitted.

- [ ] **Step 3: Run the smoke against real cmux + agentbus**

Prerequisites: the cmux app is running and `CMUX_SOCKET_PATH` is reachable from this shell (run from inside a cmux terminal for Phase 1 so `$CMUX_WORKSPACE_ID` is set); `agentbus` and `claude` are on `PATH`.

Run: `pnpm smoke "Run \`pwd\` with the Bash tool, then send the directory as your result." "$PWD"`

Expected, in order:
1. A new cmux workspace opens with an interactive `claude` running the task (visible — no `-p`).
2. Console prints `[approval] ... -> allow` when claude requests the Bash tool (the hook's `agentbus ask` round-trips through the consumer).
3. Console prints `[progress] ...` if claude sends progress.
4. Console prints `[result] runId=... text=...` and then `[smoke] adapter returned:` with `text` set and `usage` populated from the transcript (or zeros).
5. The surface stays open after the result.

- [ ] **Step 4: Capture findings against the spec's open risks**

In the commit message or a short `docs/smoke-notes.md`, record empirical answers to spec risks #1–#5: did cmux's wrapper double-intercept `PermissionRequest` (risk #3)? Did `--add-dir`/cwd resolve the transcript (risk #4)? Did claude reliably emit progress/result from the directive alone, or is the agentbus skill needed (risk #5)? Did window targeting need `--window` outside a cmux terminal (risk #1)?

> If risk #3 reproduces (double approval handling), set cmux's Claude Code integration to off in cmux Settings for these surfaces and re-run; document the exact setting. The spec's chosen resolution is "our hook is the sole approval authority."

- [ ] **Step 5: Commit**

```bash
git add src/smoke.ts docs/smoke-notes.md
git commit -m "feat: add real cmux+agentbus smoke script and notes"
```

---

## Task 13: README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`**

````markdown
# cmux-claude-adapter

An [`ai-workflow-engine`](../ai-workflow-engine) `CliAdapter` that runs **interactive**
`claude` (not `claude -p`) on a fresh [cmux](https://github.com/manaflow-ai/cmux)
surface and wires it to the [agentbus](../agentbus) message bus for progress,
tool-approval round-trips, and the final result.

Design: `docs/superpowers/specs/2026-06-13-cmux-surfaced-agents-design.md`.
Phase 1 plan: `docs/superpowers/plans/2026-06-13-cmux-claude-adapter-phase1.md`.

## How it works

`run(spec)` writes a persistent per-run dir (`~/.cmux-claude-adapter/runs/<runId>/`)
with a Claude `settings.json` that installs a `PreToolUse` hook, plus a `launch.sh`.
It launches `cmux new-workspace --command "bash launch.sh"` so only the script path
crosses the terminal — all agent data flows over agentbus. The adapter then blocks
on an injected `awaitResult(runId)`, which the single agentbus consumer resolves when
the agent sends `{type:"result",runId}` to `nagi`. Token usage is read from the
session transcript.

Approvals are deterministic: the `PreToolUse` hook calls `agentbus ask nagi` and maps
the `{behavior}` reply to Claude's permission decision (waits up to the 24h ceiling).

## Usage

```ts
import { makeCmuxClaudeAdapter } from 'cmux-claude-adapter';

const adapter = makeCmuxClaudeAdapter({
  // Resolved by the single nagi consumer when the run's result message arrives:
  awaitResult: (runId) => pendingRuns.await(runId),
});
// inject into the engine:
runWorkflow(mod, { adapters: { claude, codex, cmux: adapter }, /* ... */ });
// inside a workflow body: wf.agent(task, { cli: 'cmux' })
```

## Develop

```sh
pnpm install
pnpm test          # unit tests, no cmux/agentbus needed
pnpm build
pnpm smoke "<task>" "$PWD"   # real cmux + agentbus integration check
```

Smoke prerequisites: the cmux app running with a reachable `CMUX_SOCKET_PATH`,
and `claude` + `agentbus` on `PATH`.

## Status

Phase 1: adapter + approval hook + smoke (this package). Phase 2 (nagi
agentbus↔Slack bridge + `surface` workflow) lives in the `nagi` repo.
````

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add cmux-claude-adapter readme"
```

---

## Self-review notes (spec coverage)

- Adapter as `CliAdapter`, `id: 'cmux'`, non-schema caps → Tasks 10/11.
- agentbus contract (`ext:awe-<runId>` sender, `nagi` recipient, three kinds) → Tasks 2/5/6/7.
- Deterministic `PreToolUse` approval hook → `agentbus ask` → Task 6; settings → Task 4.
- Completion via explicit result message; usage from `--session-id` transcript; surface left open (persistent run dir, no cleanup) → Tasks 9/10.
- Injectable seams (`launchSurface`, `awaitResult`, `readUsage`) mirroring `makeClaudeAdapter({spawnFn})` → Task 10.
- Launch via `cmux new-workspace --cwd --command`; only the launcher path crosses the terminal → Tasks 3/8/10.
- Phase 1 = adapter alone + real smoke; no nagi changes → Task 12.
- Open risks #1–#5 (cmux-wrapper reconciliation, window targeting, prompt quoting, transcript hashing, agentbus-skill reliance) → empirically resolved and recorded in Task 12.
- Error handling: ask failure/timeout → deny (Tasks 5/6); launch failure → throw (Task 8); transcript missing → zero usage (Tasks 9/10). The adapter's wall-clock ceiling on `awaitResult` is owned by the injected resolver (the consumer/nagi side) and is implemented in Phase 2; for the smoke, completion is bounded by manual observation.
