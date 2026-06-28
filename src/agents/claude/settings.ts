import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EscalationPolicy } from 'ai-workflow-engine';

export interface ApprovalSettingsInput {
  runDir: string;
  runId: string;
  /** The agent's session id; recorded in meta so the Stop hook can resolve the transcript deterministically. */
  sessionId: string;
  nagiInstance: string;
  policy: EscalationPolicy;
  /**
   * Full command prefix for the PreToolUse hook; `--meta <path>` is appended.
   * SECURITY: embedded verbatim into a shell-executed hook command, so it MUST
   * be a trusted, already-quoted command string with no untrusted/user input
   * (the adapter builds it from process.execPath + the hook helper path).
   */
  hookCommand: string;
  /**
   * Full command prefix for the Stop hook (final-result reporting); `--meta
   * <path>` is appended. Same security contract as `hookCommand`.
   */
  stopHookCommand: string;
  /** Path to the declared JSON Schema; when set, recorded in meta so the Stop hook validates against it. */
  schemaPath?: string;
  /** Max Stop-hook repair rounds before the run is reported failed. */
  maxRepairs?: number;
}

export function hookTimeoutSeconds(policy: EscalationPolicy): number {
  if (policy.onTimeout === 'wait') return 86_400;
  return Math.ceil(policy.timeoutMs / 1000) + 60;
}

export function writeApprovalSettings(input: ApprovalSettingsInput): string {
  mkdirSync(input.runDir, { recursive: true });
  const metaPath = join(input.runDir, 'meta.json');
  writeFileSync(
    metaPath,
    JSON.stringify({
      runId: input.runId,
      sessionId: input.sessionId,
      nagiInstance: input.nagiInstance,
      timeoutMs: input.policy.onTimeout === 'wait' ? 86_400_000 : input.policy.timeoutMs,
      ...(input.schemaPath !== undefined ? { schemaPath: input.schemaPath } : {}),
      ...(input.maxRepairs !== undefined ? { maxRepairs: input.maxRepairs } : {}),
    }),
  );
  const settings = {
    hooks: {
      PreToolUse: [
        {
          matcher: '*',
          hooks: [
            {
              type: 'command',
              command: `${input.hookCommand} --meta "${metaPath}"`,
              timeout: hookTimeoutSeconds(input.policy),
            },
          ],
        },
      ],
      // At end of turn, report the final assistant message as the run's result
      // over agentbus (deterministic reporting; does not block the agent).
      Stop: [
        {
          matcher: '',
          hooks: [
            {
              type: 'command',
              command: `${input.stopHookCommand} --meta "${metaPath}"`,
              timeout: 120,
            },
          ],
        },
      ],
    },
  };
  const settingsPath = join(input.runDir, 'settings.json');
  writeFileSync(settingsPath, JSON.stringify(settings));
  return settingsPath;
}
