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
});
