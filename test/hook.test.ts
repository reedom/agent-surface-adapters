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
