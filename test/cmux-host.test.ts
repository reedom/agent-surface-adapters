import { describe, expect, it, vi } from 'vitest';
import { makeCmuxHost } from '../src/hosts/cmux.js';
import type { RunFn } from '../src/core/run.js';

function recordingRunner(stdoutByVerb: Record<string, string> = {}) {
  const calls: string[][] = [];
  const runner: RunFn = async (_bin, args) => {
    calls.push(args);
    // Skip the value that follows each global value-flag (--socket VAL, --password VAL)
    // so the first real subcommand token is treated as the verb.
    const valueFlags = new Set(['--socket', '--password']);
    let verb = '';
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (valueFlags.has(arg)) {
        i++;
        continue;
      }
      if (!arg.startsWith('--')) {
        verb = arg;
        break;
      }
    }
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
  // cmux `new-workspace` (now an alias for `workspace create`) ignores `--json` and prints
  // plain text like `OK workspace:40`, so we parse the ordinal ref, not JSON.
  it('createWorkspace parses the plain-text ref and passes --name/--description', async () => {
    const { runner, calls } = recordingRunner({ 'new-workspace': 'OK workspace:40' });
    const host = makeCmuxHost({ runner });
    const r = await host.createWorkspace!({ cwd: '/repo', command: 'bash x.sh', meta: { name: 'ABC-1', description: 'do it' } });
    expect(r.workspace.ref).toBe('workspace:40');
    // The first agent's surface handle is the workspace ref; we do not make a second list call.
    expect(r.surface.ref).toBe('workspace:40');
    expect(calls.some((c) => c.includes('list-pane-surfaces'))).toBe(false);
    const create = calls.find((c) => c.includes('new-workspace'))!;
    expect(create).toEqual(expect.arrayContaining(['--name', 'ABC-1', '--description', 'do it', '--cwd', '/repo', '--command', 'bash x.sh']));
  });

  it('createWorkspace also accepts JSON workspace_id output (forward-compat)', async () => {
    const { runner } = recordingRunner({ 'new-workspace': JSON.stringify({ workspace_id: 'ws-uuid-1' }) });
    const host = makeCmuxHost({ runner });
    const r = await host.createWorkspace!({ command: 'bash x.sh' });
    expect(r.workspace.ref).toBe('ws-uuid-1');
  });

  it('addSurface opens a terminal tab in the run workspace then types the launch command into it', async () => {
    const { runner, calls } = recordingRunner({
      'new-surface': JSON.stringify({ pane_ref: 'pane:2', surface_ref: 'surface:7' }),
    });
    const host = makeCmuxHost({ runner });
    const r = await host.addSurface!({ workspaceRef: 'ws-1', cwd: '/repo', command: 'bash y.sh' });
    expect(r.ref).toBe('surface:7');
    // new-surface only opens a bare tab (no --command)...
    expect(calls[0]).toEqual(expect.arrayContaining(['new-surface', '--workspace', 'ws-1', '--type', 'terminal', '--focus', 'true', '--json']));
    expect(calls[0]).not.toContain('--command');
    // ...then the command is typed into that exact surface and submitted.
    expect(calls[1]).toEqual(['send', '--surface', 'surface:7', "cd '/repo' && exec bash y.sh"]);
    expect(calls[2]).toEqual(['send-key', '--surface', 'surface:7', 'Return']);
  });

  it('createWorkspace throws when the ref is unparsable (fail fast, not undefined)', async () => {
    const { runner } = recordingRunner({ 'new-workspace': 'Error: socket not found' });
    const host = makeCmuxHost({ runner });
    await expect(host.createWorkspace!({ command: 'bash x.sh' })).rejects.toThrow(/could not parse a workspace ref/);
  });

  it('addSurface throws when the surface ref is unparsable (no silent undefined)', async () => {
    const { runner } = recordingRunner({ 'new-surface': 'something went wrong' });
    const host = makeCmuxHost({ runner });
    await expect(host.addSurface!({ workspaceRef: 'workspace:1', command: 'bash y.sh' })).rejects.toThrow(/could not parse a surface ref/);
  });

  it('setMeta renames and sets description', async () => {
    const { runner, calls } = recordingRunner();
    const host = makeCmuxHost({ runner });
    await host.setMeta!('ws-1', { name: 'ABC-1', description: 'a title' });
    expect(calls[0]).toEqual(expect.arrayContaining(['rename-workspace', '--workspace', 'ws-1', '--', 'ABC-1']));
    expect(calls[1]).toEqual(expect.arrayContaining(['workspace-action', '--action', 'set-description', '--workspace', 'ws-1', '--description', 'a title']));
  });
});
