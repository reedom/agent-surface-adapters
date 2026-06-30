import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeSurfaceAdapter } from '../src/core/adapter.js';
import type { SurfaceHost, AgentProfile } from '../src/core/types.js';

let runsDir: string;
beforeEach(() => { runsDir = mkdtempSync(join(tmpdir(), 'runs-')); });
afterEach(() => rmSync(runsDir, { recursive: true, force: true }));

function fakeProfile(): AgentProfile {
  return {
    id: 'claude', bin: 'claude',
    buildArgs: () => ['-p'],
    writeApprovalSettings: () => '/tmp/settings.json',
    readUsage: () => ({ inputTokens: 0, outputTokens: 0 }),
  };
}

function fakeHost(): SurfaceHost & { calls: string[] } {
  const calls: string[] = [];
  return {
    id: 'cmux', calls,
    launch: async () => ({ raw: 'L', ref: 'L' }),
    createWorkspace: async ({ meta }) => {
      calls.push(`create:${meta?.name ?? ''}`);
      return { workspace: { raw: 'ws', ref: 'ws' }, surface: { raw: 's0', ref: 's0' } };
    },
    addSurface: async () => { calls.push('add'); return { raw: 's1', ref: 's1' }; },
    setMeta: async (_ws, m) => { calls.push(`meta:${m.name ?? ''}/${m.description ?? ''}`); },
  } as SurfaceHost & { calls: string[] };
}

describe('surface adapter workspace model', () => {
  it('first run creates the workspace with sticky meta; later run adds a surface', async () => {
    const host = fakeHost();
    const adapter = makeSurfaceAdapter({ host, agent: fakeProfile(), awaitResult: async () => ({ text: 'ok' }), runsDir }) as any;
    await adapter.setMeta({ name: 'ABC-1' });
    await adapter.run({ prompt: 'a', escalation: { runId: 'r' } });
    await adapter.run({ prompt: 'b', escalation: { runId: 'r' } });
    expect(host.calls).toEqual(['create:ABC-1', 'add']);
  });

  it('setMeta after the workspace exists renames live', async () => {
    const host = fakeHost();
    const adapter = makeSurfaceAdapter({ host, agent: fakeProfile(), awaitResult: async () => ({ text: 'ok' }), runsDir }) as any;
    await adapter.run({ prompt: 'a', escalation: { runId: 'r' } });
    await adapter.setMeta({ description: 'a title' });
    expect(host.calls).toEqual(['create:', 'meta:/a title']);
  });

  it('setMeta no-ops on a non-workspace host (launch fallback) rather than buffering forever', async () => {
    const calls: string[] = [];
    const launchOnly: SurfaceHost = { id: 'plain', launch: async () => { calls.push('launch'); return { raw: 'L', ref: 'L' }; } };
    const adapter = makeSurfaceAdapter({ host: launchOnly, agent: fakeProfile(), awaitResult: async () => ({ text: 'ok' }), runsDir }) as any;
    await adapter.setMeta({ name: 'ABC-1' });
    await adapter.run({ prompt: 'a', escalation: { runId: 'r' } });
    await adapter.setMeta({ description: 'after' });
    expect(calls).toEqual(['launch']); // no meta plumbing attempted
  });

  it('setMeta throws if a workspace host omits live setMeta after creation', async () => {
    const host = fakeHost();
    delete (host as Partial<SurfaceHost>).setMeta; // has createWorkspace+addSurface but no setMeta
    const adapter = makeSurfaceAdapter({ host, agent: fakeProfile(), awaitResult: async () => ({ text: 'ok' }), runsDir }) as any;
    await adapter.run({ prompt: 'a', escalation: { runId: 'r' } });
    await expect(adapter.setMeta({ description: 'x' })).rejects.toThrow(/does not support live setMeta/);
  });
});
