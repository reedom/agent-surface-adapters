import { spawn } from 'node:child_process';

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface RunOpts {
  cwd?: string;
  /** When set, written to the child's stdin and stdin is then closed. */
  input?: string;
}

export type RunFn = (cmd: string, args: string[], opts?: RunOpts) => Promise<RunResult>;

// Smoke-only dependency: no unit test by design (exercised via the CLI wrappers and the real smoke).
export const runProcess: RunFn = (cmd, args, opts) =>
  new Promise((resolve, reject) => {
    const useStdin = opts?.input !== undefined;
    const child = spawn(cmd, args, {
      cwd: opts?.cwd,
      stdio: [useStdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => {
      stdout += d;
    });
    child.stderr?.on('data', (d) => {
      stderr += d;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ stdout, stderr, code: code ?? -1 }));
    if (useStdin && child.stdin) {
      child.stdin.write(opts!.input!);
      child.stdin.end();
    }
  });
