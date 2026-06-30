import { describe, expect, it, vi } from 'vitest';
import { makeCmuxHost } from '../src/hosts/cmux.js';
import type { RunFn } from '../src/core/run.js';

function recordingRunner(stdoutByVerb: Record<string, string> = {}) {
  const calls: string[][] = [];
  const runner: RunFn = async (_bin, args) => {
    calls.push(args);
    const verb = args.find((a) => !a.startsWith('--')) ?? '';
    return { stdout: stdoutByVerb[verb] ?? '', stderr: '', code: 0 };
  };
  return { runner, calls };
}

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

describe('cmux host workspace verbs', () => {
  it('createWorkspace passes --name/--description and resolves the initial surface', async () => {
    const { runner, calls } = recordingRunner({
      'new-workspace': JSON.stringify({ workspace_id: 'ws-1' }),
      'list-pane-surfaces': JSON.stringify({ surfaces: [{ id: 'sf-1' }] }),
    });
    const host = makeCmuxHost({ runner });
    const r = await host.createWorkspace!({ cwd: '/repo', command: 'bash x.sh', meta: { name: 'ABC-1', description: 'do it' } });
    expect(r.workspace.ref).toBe('ws-1');
    expect(r.surface.ref).toBe('sf-1');
    const create = calls.find((c) => c.includes('new-workspace'))!;
    expect(create).toEqual(expect.arrayContaining(['--name', 'ABC-1', '--description', 'do it', '--cwd', '/repo', '--command', 'bash x.sh', '--json']));
  });

  it('addSurface targets the parent workspace', async () => {
    const { runner, calls } = recordingRunner({ 'new-surface': JSON.stringify({ surface: 'sf-2' }) });
    const host = makeCmuxHost({ runner });
    const r = await host.addSurface!({ workspaceRef: 'ws-1', cwd: '/repo', command: 'bash y.sh' });
    expect(r.ref).toBe('sf-2');
    expect(calls[0]).toEqual(expect.arrayContaining(['new-surface', '--workspace', 'ws-1', '--cwd', '/repo', '--command', 'bash y.sh']));
  });

  it('setMeta renames and sets description', async () => {
    const { runner, calls } = recordingRunner();
    const host = makeCmuxHost({ runner });
    await host.setMeta!('ws-1', { name: 'ABC-1', description: 'a title' });
    expect(calls[0]).toEqual(expect.arrayContaining(['rename-workspace', '--workspace', 'ws-1', 'ABC-1']));
    expect(calls[1]).toEqual(expect.arrayContaining(['workspace-action', '--action', 'set-description', '--workspace', 'ws-1', '--description', 'a title']));
  });
});
