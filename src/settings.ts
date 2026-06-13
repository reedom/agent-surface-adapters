import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EscalationPolicy } from 'ai-workflow-engine';

export interface ApprovalSettingsInput {
  runDir: string;
  runId: string;
  nagiInstance: string;
  policy: EscalationPolicy;
  /** Full command prefix for the PreToolUse hook; `--meta <path>` is appended. */
  hookCommand: string;
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
      nagiInstance: input.nagiInstance,
      timeoutMs: input.policy.onTimeout === 'wait' ? 86_400_000 : input.policy.timeoutMs,
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
    },
  };
  const settingsPath = join(input.runDir, 'settings.json');
  writeFileSync(settingsPath, JSON.stringify(settings));
  return settingsPath;
}
