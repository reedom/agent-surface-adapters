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

  // cmux output is not reliably JSON: `new-workspace` (now an alias for `workspace
  // create`) ignores `--json` and prints plain text like `OK workspace:40`. Extract a
  // `<kind>:<n>` ordinal ref or a UUID from whatever it prints, falling back to JSON keys.
  const parseRef = (stdout: string, kind: 'workspace' | 'surface'): string | undefined => {
    const ordinal = stdout.match(new RegExp(`${kind}:\\d+`));
    if (ordinal) return ordinal[0];
    try {
      const j = JSON.parse(stdout) as Record<string, unknown>;
      const v = j[`${kind}_id`] ?? j[kind] ?? j.id;
      if (typeof v === 'string') return v;
    } catch {
      /* not JSON */
    }
    const uuid = stdout.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    return uuid ? uuid[0] : undefined;
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
      const wsRef = parseRef(r.stdout, 'workspace');
      if (!wsRef) throw new Error(`cmux new-workspace: could not parse a workspace ref from: ${r.stdout.trim().slice(0, 200)}`);
      // The first agent runs in the workspace's initial surface; use the workspace ref as
      // its handle (cmux addresses surfaces by workspace) rather than a second list call.
      return { workspace: { raw: r.stdout.trim(), ref: wsRef }, surface: { raw: r.stdout.trim(), ref: wsRef } };
    },
    async addSurface({ workspaceRef, cwd, command }) {
      const args = globalArgs();
      args.push('new-surface', '--workspace', workspaceRef);
      if (cwd) args.push('--cwd', cwd);
      args.push('--command', command, '--focus', 'true', '--json');
      const r = await run(bin, args);
      if (r.code !== 0) throw new Error(`cmux new-surface failed: ${r.stderr.trim().slice(0, 300)}`);
      return { raw: r.stdout.trim(), ref: parseRef(r.stdout, 'surface') };
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
