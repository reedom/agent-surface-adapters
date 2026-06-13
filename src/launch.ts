import { runProcess, type RunFn } from './run.js';

export interface LaunchInput {
  cwd?: string;
  command: string;
  runner?: RunFn;
  bin?: string;
}

export interface SurfaceRef {
  raw: string;
  ref?: string;
}

export async function launchSurface(input: LaunchInput): Promise<SurfaceRef> {
  const bin = input.bin ?? 'cmux';
  const run = input.runner ?? runProcess;
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
}
