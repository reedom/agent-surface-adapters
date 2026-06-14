import { execPath } from 'node:process';
import { fileURLToPath } from 'node:url';
import type { AgentProfile } from '../../core/types.js';
import { buildClaudeArgs } from './command.js';
import { writeApprovalSettings } from './settings.js';
import { readUsage } from './result.js';

export function makeClaudeProfile(
  opts: { bin?: string; hookHelperPath?: string; reportHookHelperPath?: string } = {},
): AgentProfile {
  const bin = opts.bin ?? 'claude';
  const hookHelperPath =
    opts.hookHelperPath ?? fileURLToPath(new URL('./hook/approve-via-agentbus.js', import.meta.url));
  const reportHookHelperPath =
    opts.reportHookHelperPath ??
    fileURLToPath(new URL('./hook/report-result-via-agentbus.js', import.meta.url));
  return {
    id: 'claude',
    bin,
    buildArgs: (input) => buildClaudeArgs(input),
    writeApprovalSettings: ({ runDir, runId, sessionId, nagiInstance, policy }) =>
      writeApprovalSettings({
        runDir,
        runId,
        sessionId,
        nagiInstance,
        policy,
        hookCommand: `"${execPath}" "${hookHelperPath}"`,
        stopHookCommand: `"${execPath}" "${reportHookHelperPath}"`,
      }),
    readUsage: (sessionId) => readUsage(sessionId),
  };
}
