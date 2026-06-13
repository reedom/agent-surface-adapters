import { execPath } from 'node:process';
import { fileURLToPath } from 'node:url';
import type { AgentProfile } from '../../core/types.js';
import { buildClaudeArgs } from './command.js';
import { writeApprovalSettings } from './settings.js';
import { readUsage } from './result.js';

export function makeClaudeProfile(opts: { bin?: string; hookHelperPath?: string } = {}): AgentProfile {
  const bin = opts.bin ?? 'claude';
  const hookHelperPath =
    opts.hookHelperPath ?? fileURLToPath(new URL('./hook/approve-via-agentbus.js', import.meta.url));
  return {
    id: 'claude',
    bin,
    buildArgs: (input) => buildClaudeArgs(input),
    writeApprovalSettings: ({ runDir, runId, nagiInstance, policy }) =>
      writeApprovalSettings({
        runDir,
        runId,
        nagiInstance,
        policy,
        hookCommand: `"${execPath}" "${hookHelperPath}"`,
      }),
    readUsage: (sessionId) => readUsage(sessionId),
  };
}
