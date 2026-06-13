import { runProcess, type RunFn } from '../core/run.js';
import type { SurfaceHost, SurfaceRef } from '../core/types.js';

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
    // Drive a resident REPL: type text, then submit/control with a key.
    async send(surfaceRef, text): Promise<void> {
      await runOrThrow('send', ['send', '--surface', surfaceRef, text]);
    },
    async sendKey(surfaceRef, key): Promise<void> {
      await runOrThrow('send-key', ['send-key', '--surface', surfaceRef, key]);
    },
  };
}
