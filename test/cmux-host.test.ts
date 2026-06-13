import { describe, expect, it, vi } from 'vitest';
import { makeCmuxHost } from '../src/hosts/cmux.js';
import type { RunFn } from '../src/core/run.js';

describe('makeCmuxHost', () => {
  it('calls cmux new-workspace with cwd, command and --json, returning a ref', async () => {
    const runner = vi.fn() as unknown as RunFn;
    vi.mocked(runner).mockResolvedValue({ stdout: '{"surface":"surface:4"}', stderr: '', code: 0 });
    const host = makeCmuxHost({ runner });
    const ref = await host.launch({ cwd: '/repo', command: 'bash /run/launch.sh' });
    expect(ref.ref).toBe('surface:4');
    const args = vi.mocked(runner).mock.calls[0][1];
    expect(args[0]).toBe('new-workspace');
    expect(args).toContain('--cwd');
    expect(args).toContain('/repo');
    expect(args).toContain('--command');
    expect(args).toContain('bash /run/launch.sh');
    expect(args).toContain('--json');
  });

  it('throws on non-zero exit', async () => {
    const runner = vi.fn() as unknown as RunFn;
    vi.mocked(runner).mockResolvedValue({ stdout: '', stderr: 'no socket', code: 1 });
    const host = makeCmuxHost({ runner });
    await expect(host.launch({ command: 'x' })).rejects.toThrow(/new-workspace failed/);
  });
});
