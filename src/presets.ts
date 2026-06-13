import type { CliAdapter } from 'ai-workflow-engine';
import type { SurfaceRef } from './core/types.js';
import { makeSurfaceAdapter } from './core/adapter.js';
import { makeCmuxHost } from './hosts/cmux.js';
import { makeClaudeProfile } from './agents/claude/profile.js';

export interface CmuxClaudeOptions {
  /** Resolved by the single nagi consumer when this run's result message arrives. REQUIRED. */
  awaitResult: (runId: string) => Promise<{ text: string }>;
  nagiInstance?: string;
  runsDir?: string;
  claudeBin?: string;
  hookHelperPath?: string;
  cmuxBin?: string;
  cmuxSocketPath?: string;
  cmuxPassword?: string;
  cmuxWindow?: string;
  newRunId?: () => string;
  newSessionId?: () => string;
  onSurface?: (surface: SurfaceRef) => void;
}

export function makeCmuxClaudeAdapter(opts: CmuxClaudeOptions): CliAdapter {
  return makeSurfaceAdapter({
    id: 'cmux',
    host: makeCmuxHost({ bin: opts.cmuxBin, socketPath: opts.cmuxSocketPath, password: opts.cmuxPassword, window: opts.cmuxWindow }),
    agent: makeClaudeProfile({ bin: opts.claudeBin, hookHelperPath: opts.hookHelperPath }),
    awaitResult: opts.awaitResult,
    nagiInstance: opts.nagiInstance,
    runsDir: opts.runsDir,
    newRunId: opts.newRunId,
    newSessionId: opts.newSessionId,
    onSurface: opts.onSurface,
  });
}
