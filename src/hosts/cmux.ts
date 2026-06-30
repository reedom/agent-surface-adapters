import { runProcess, type RunFn } from '../core/run.js';
import type { SurfaceHost, SurfaceRef, SurfaceMeta } from '../core/types.js';

export interface CmuxHostOptions {
  bin?: string;
  runner?: RunFn;
  socketPath?: string;
  password?: string;
  window?: string;
}

export function makeCmuxHost(opts: CmuxHostOptions = {}): SurfaceHost {
  const bin = opts.bin ?? 'cmux';
  const run = opts.runner ?? runProcess;

  // Global socket/password options must precede the subcommand.
  const globalArgs = (): string[] => {
    const args: string[] = [];
    if (opts.socketPath) args.push('--socket', opts.socketPath);
    if (opts.password) args.push('--password', opts.password);
    return args;
  };

  const runOrThrow = async (verb: string, args: string[]): Promise<void> => {
    const r = await run(bin, [...globalArgs(), ...args]);
    if (r.code !== 0) throw new Error(`cmux ${verb} failed: ${r.stderr.trim().slice(0, 300)}`);
  };

  return {
    id: 'cmux',
    async launch(input): Promise<SurfaceRef> {
      const args = globalArgs();
      args.push('new-workspace');
      if (input.cwd) args.push('--cwd', input.cwd);
      args.push('--command', input.command, '--json');
      if (opts.window) args.push('--window', opts.window);
      const r = await run(bin, args);
      if (r.code !== 0) throw new Error(`cmux new-workspace failed: ${r.stderr.trim().slice(0, 300)}`);
      let ref: string | undefined;
      try {
        const j = JSON.parse(r.stdout) as Record<string, unknown>;
        const found = j.surface ?? j.workspace ?? j.id;
        ref = typeof found === 'string' ? found : undefined;
      } catch {
        // ref-text output is fine; keep raw only
      }
      return { raw: r.stdout.trim(), ref };
    },
    async createWorkspace({ cwd, command, meta }) {
      const args = globalArgs();
      args.push('new-workspace');
      if (meta?.name) args.push('--name', meta.name);
      if (meta?.description) args.push('--description', meta.description);
      if (cwd) args.push('--cwd', cwd);
      args.push('--command', command, '--json');
      if (opts.window) args.push('--window', opts.window);
      const r = await run(bin, args);
      if (r.code !== 0) throw new Error(`cmux new-workspace failed: ${r.stderr.trim().slice(0, 300)}`);
      const wsId = (JSON.parse(r.stdout) as { workspace_id?: string }).workspace_id;
      if (!wsId) throw new Error('cmux new-workspace returned no workspace_id');
      const ls = await run(bin, [...globalArgs(), 'list-pane-surfaces', '--workspace', wsId, '--json']);
      if (ls.code !== 0) throw new Error(`cmux list-pane-surfaces failed: ${ls.stderr.trim().slice(0, 300)}`);
      const surfaceId = (JSON.parse(ls.stdout) as { surfaces?: Array<{ id?: string }> }).surfaces?.[0]?.id;
      return { workspace: { raw: r.stdout.trim(), ref: wsId }, surface: { raw: ls.stdout.trim(), ref: surfaceId } };
    },
    async addSurface({ workspaceRef, cwd, command }) {
      const args = globalArgs();
      args.push('new-surface', '--workspace', workspaceRef);
      if (cwd) args.push('--cwd', cwd);
      args.push('--command', command, '--focus', 'true', '--json');
      const r = await run(bin, args);
      if (r.code !== 0) throw new Error(`cmux new-surface failed: ${r.stderr.trim().slice(0, 300)}`);
      let ref: string | undefined;
      try { const j = JSON.parse(r.stdout) as Record<string, unknown>; const f = j.surface ?? j.id; ref = typeof f === 'string' ? f : undefined; } catch { /* keep raw */ }
      return { raw: r.stdout.trim(), ref };
    },
    async setMeta(workspaceRef, meta) {
      if (meta.name) await runOrThrow('rename-workspace', ['rename-workspace', '--workspace', workspaceRef, meta.name]);
      if (meta.description) await runOrThrow('workspace-action', ['workspace-action', '--action', 'set-description', '--workspace', workspaceRef, '--description', meta.description]);
    },
    // Drive a resident REPL: type text, then submit/control with a key.
    async send(surfaceRef, text): Promise<void> {
      await runOrThrow('send', ['send', '--surface', surfaceRef, text]);
    },
    async sendKey(surfaceRef, key): Promise<void> {
      await runOrThrow('send-key', ['send-key', '--surface', surfaceRef, key]);
    },
  };
}
