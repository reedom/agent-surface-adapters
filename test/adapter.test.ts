import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentSpec } from 'ai-workflow-engine';
import { makeSurfaceAdapter } from '../src/core/adapter.js';
import type { AgentProfile, SurfaceHost, SurfaceRef } from '../src/core/types.js';

let runsDir: string;
beforeEach(() => { runsDir = mkdtempSync(join(tmpdir(), 'runs-')); });
afterEach(() => rmSync(runsDir, { recursive: true, force: true }));

function fakeAgent(over: Partial<AgentProfile> = {}): AgentProfile {
  return {
    id: 'claude', bin: 'claude',
    buildArgs: () => ['--session-id', 'sess-1', '--', 'do the thing'],
    writeApprovalSettings: ({ runDir }) => join(runDir, 'settings.json'),
    readUsage: () => ({ inputTokens: 7, outputTokens: 3 }),
    ...over,
  };
}
function fakeHost(launch: SurfaceHost['launch']): SurfaceHost { return { id: 'cmux', launch }; }
function spec(over: Partial<AgentSpec> = {}): AgentSpec { return { prompt: 'do the thing', cwd: '/repo', ...over }; }

describe('makeSurfaceAdapter', () => {
  it('uses host id by default and schema-capable caps', () => {
    const a = makeSurfaceAdapter({ host: fakeHost(async () => ({ raw: '' })), agent: fakeAgent(), awaitResult: async () => ({ text: '' }) });
    expect(a.id).toBe('cmux');
    expect(a.caps).toEqual({ schema: true, resume: false, tools: true });
  });
  it('honors an explicit id override', () => {
    const a = makeSurfaceAdapter({ id: 'cmux-codex', host: fakeHost(async () => ({ raw: '' })), agent: fakeAgent(), awaitResult: async () => ({ text: '' }) });
    expect(a.id).toBe('cmux-codex');
  });
  it('launches a surface running the per-run launcher and returns awaited result + usage', async () => {
    let launched: { cwd?: string; command: string } | undefined;
    const host = fakeHost(async (input): Promise<SurfaceRef> => { launched = input; return { raw: 'OK', ref: 'surface:1' }; });
    const awaitResult = vi.fn(async (_runId: string) => ({ text: 'final answer' }));
    const a = makeSurfaceAdapter({ host, agent: fakeAgent(), awaitResult, runsDir, newRunId: () => 'run-1', newSessionId: () => 'sess-1' });
    const result = await a.run(spec());
    expect(result.text).toBe('final answer');
    expect(result.usage).toEqual({ inputTokens: 7, outputTokens: 3 });
    expect(result.sessionId).toBe('sess-1');
    expect(awaitResult).toHaveBeenCalledWith('run-1');
    expect(launched?.cwd).toBe('/repo');
    expect(launched?.command).toMatch(/^bash '.*run-1\/launch\.sh'$/);
    expect(existsSync(join(runsDir, 'run-1', 'launch.sh'))).toBe(true);
  });
  it('falls back to zero usage when the profile returns null', async () => {
    const a = makeSurfaceAdapter({ host: fakeHost(async () => ({ raw: '' })), agent: fakeAgent({ readUsage: () => null }), awaitResult: async () => ({ text: 'x' }), runsDir, newRunId: () => 'run-2', newSessionId: () => 'sess-2' });
    const result = await a.run(spec());
    expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });
  it('invokes onSurface with the launched surface ref before the result resolves', async () => {
    const knownSurface: SurfaceRef = { raw: 'OK workspace:7', ref: 'workspace:7' };
    const host = fakeHost(async (): Promise<SurfaceRef> => knownSurface);
    const onSurface = vi.fn();
    const a = makeSurfaceAdapter({
      host,
      agent: fakeAgent(),
      awaitResult: async () => ({ text: 'done' }),
      onSurface,
      runsDir,
      newRunId: () => 'run-3',
      newSessionId: () => 'sess-3',
    });
    await a.run(spec());
    expect(onSurface).toHaveBeenCalledOnce();
    expect(onSurface).toHaveBeenCalledWith(knownSurface);
  });
});
