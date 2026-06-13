import { runProcess, type RunFn } from '../core/run.js';
import type { SurfaceHost, SurfaceRef } from '../core/types.js';

export function makeCmuxHost(opts: { bin?: string; runner?: RunFn } = {}): SurfaceHost {
  const bin = opts.bin ?? 'cmux';
  const run = opts.runner ?? runProcess;
  return {
    id: 'cmux',
    async launch(input): Promise<SurfaceRef> {
      const args = ['new-workspace'];
      if (input.cwd) args.push('--cwd', input.cwd);
      args.push('--command', input.command, '--json');
      const r = await run(bin, args);
      if (r.code !== 0) throw new Error(`cmux new-workspace failed: ${r.stderr.trim().slice(0, 300)}`);
      let ref: string | undefined;
      try {
        const j = JSON.parse(r.stdout) as Record<string, unknown>;
        const found = j.surface ?? j.workspace ?? j.id;
        ref = typeof found === 'string' ? found : undefined;
      } catch {
        // ref-text output (no --json support) is fine; keep raw only
      }
      return { raw: r.stdout.trim(), ref };
    },
  };
}
