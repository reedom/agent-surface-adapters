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

  it('prepends global --socket/--password and adds --window to new-workspace', async () => {
    const runner = vi.fn() as unknown as RunFn;
    vi.mocked(runner).mockResolvedValue({ stdout: 'OK workspace:2', stderr: '', code: 0 });
    const host = makeCmuxHost({ runner, socketPath: '/tmp/cmux.sock', password: 'pw', window: 'window:1' });
    await host.launch({ cwd: '/repo', command: 'bash /run/launch.sh' });
    const args = vi.mocked(runner).mock.calls[0][1];
    // global options precede the subcommand
    expect(args.slice(0, 4)).toEqual(['--socket', '/tmp/cmux.sock', '--password', 'pw']);
    expect(args).toContain('new-workspace');
    expect(args).toContain('--window');
    expect(args).toContain('window:1');
  });

  it('send types text into a surface, with global opts preceding the subcommand', async () => {
    const runner = vi.fn() as unknown as RunFn;
    vi.mocked(runner).mockResolvedValue({ stdout: '', stderr: '', code: 0 });
    const host = makeCmuxHost({ runner, socketPath: '/tmp/cmux.sock', password: 'pw' });
    await host.send?.('surface:4', 'review the auth module');
    const args = vi.mocked(runner).mock.calls[0][1];
    expect(args).toEqual([
      '--socket', '/tmp/cmux.sock', '--password', 'pw',
      'send', '--surface', 'surface:4', 'review the auth module',
    ]);
  });

  it('sendKey sends a single key to a surface', async () => {
    const runner = vi.fn() as unknown as RunFn;
    vi.mocked(runner).mockResolvedValue({ stdout: '', stderr: '', code: 0 });
    const host = makeCmuxHost({ runner });
    await host.sendKey?.('surface:4', 'Return');
    const args = vi.mocked(runner).mock.calls[0][1];
    expect(args).toEqual(['send-key', '--surface', 'surface:4', 'Return']);
  });

  it('send throws on non-zero exit', async () => {
    const runner = vi.fn() as unknown as RunFn;
    vi.mocked(runner).mockResolvedValue({ stdout: '', stderr: 'no such surface', code: 1 });
    const host = makeCmuxHost({ runner });
    await expect(host.send?.('surface:9', 'hi')).rejects.toThrow(/send failed/);
  });
});
