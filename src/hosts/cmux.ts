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
  // create`) ignores `--json` and prints plain text like `OK workspace:40`. Probe in
  // order: (1) a `<kind>:<n>` ordinal ref, (2) JSON keys (`<kind>_id` / `<kind>` / `id`),
  // (3) a bare UUID as last resort. Returns undefined only when none match.
  const parseRef = (stdout: string, kind: 'workspace' | 'surface'): string | undefined => {
    const ordinal = stdout.match(new RegExp(`${kind}:\\d+`));
    if (ordinal) return ordinal[0];
    try {
      const j = JSON.parse(stdout) as Record<string, unknown>;
      const v = j[`${kind}_id`] ?? j[kind] ?? j.id;
      if (typeof v === 'string') return v;
    } catch (err) {
      if (!(err instanceof SyntaxError)) throw err; // only non-JSON is expected here
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
      } catch (err) {
        if (!(err instanceof SyntaxError)) throw err; // non-JSON ref-text is fine; keep raw only
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
      // Use the workspace ref as the first surface's handle to skip a list-pane-surfaces
      // round-trip. ASSUMPTION: cmux accepts a workspace ref in `--surface` for send/sendKey;
      // verify against cmux before driving the initial surface's REPL.
      return { workspace: { raw: r.stdout.trim(), ref: wsRef }, surface: { raw: r.stdout.trim(), ref: wsRef } };
    },
    async addSurface({ workspaceRef, cwd, command }) {
      const args = globalArgs();
      args.push('new-surface', '--workspace', workspaceRef);
      if (cwd) args.push('--cwd', cwd);
      args.push('--command', command, '--focus', 'true', '--json');
      const r = await run(bin, args);
      if (r.code !== 0) throw new Error(`cmux new-surface failed: ${r.stderr.trim().slice(0, 300)}`);
      const ref = parseRef(r.stdout, 'surface');
      // Fail fast like createWorkspace: an unparsable ref would otherwise reach send/sendKey
      // as `undefined` and surface only as an opaque cmux error.
      if (!ref) throw new Error(`cmux new-surface: could not parse a surface ref from: ${r.stdout.trim().slice(0, 200)}`);
      return { raw: r.stdout.trim(), ref };
    },
    async setMeta(workspaceRef, meta) {
      // `--` ends option parsing so a name starting with `-` is taken as the positional title.
      if (meta.name) await runOrThrow('rename-workspace', ['rename-workspace', '--workspace', workspaceRef, '--', meta.name]);
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
