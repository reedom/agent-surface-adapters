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

  it('writes the deny-policy timeout into both meta and the hook', () => {
    const settingsPath = writeApprovalSettings({
      runDir: dir, runId: 'run-8', nagiInstance: 'nagi',
      policy: { timeoutMs: 5500, onTimeout: 'deny' },
      hookCommand: '"/usr/bin/node" "/pkg/dist/hook/approve-via-agentbus.js"',
    });
    const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
    expect(meta.timeoutMs).toBe(5500);
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    expect(settings.hooks.PreToolUse[0].hooks[0].timeout).toBe(66);
  });
});
