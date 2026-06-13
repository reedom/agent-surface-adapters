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
    }) as unknown as (input: LaunchInput) => Promise<SurfaceRef>;
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
