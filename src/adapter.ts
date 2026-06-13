import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execPath } from 'node:process';
import { fileURLToPath } from 'node:url';
import type { AgentResult, AgentSpec, CliAdapter, EscalationPolicy } from 'ai-workflow-engine';
import { writeApprovalSettings } from './settings.js';
import { agentbusDirective, composeSystemPrompt } from './prompt.js';
import { buildClaudeArgs, launcherScript, shellQuote } from './command.js';
import { launchSurface as defaultLaunchSurface, type LaunchInput, type SurfaceRef } from './launch.js';
import { readUsage as defaultReadUsage, type AgentUsage } from './result.js';

const DEFAULT_POLICY: EscalationPolicy = { timeoutMs: 86_400_000, onTimeout: 'wait' };

export interface CmuxAdapterDeps {
  /** Resolved by the single nagi consumer when this run's result message arrives. REQUIRED. */
  awaitResult: (runId: string) => Promise<{ text: string }>;
  nagiInstance?: string;
  claudeBin?: string;
  /** Absolute path to the built hook helper (dist/hook/approve-via-agentbus.js). */
  hookHelperPath?: string;
  /** Persistent per-run dir root (default ~/.cmux-claude-adapter/runs). NOT cleaned up. */
  runsDir?: string;
  launchSurface?: (input: LaunchInput) => Promise<SurfaceRef>;
  readUsage?: (sessionId: string) => AgentUsage | null;
  newRunId?: () => string;
  newSessionId?: () => string;
}

export function makeCmuxClaudeAdapter(deps: CmuxAdapterDeps): CliAdapter {
  const nagiInstance = deps.nagiInstance ?? 'nagi';
  const claudeBin = deps.claudeBin ?? 'claude';
  const runsDir = deps.runsDir ?? join(homedir(), '.cmux-claude-adapter', 'runs');
  const launch = deps.launchSurface ?? defaultLaunchSurface;
  const readUsage = deps.readUsage ?? defaultReadUsage;
  const hookHelperPath =
    deps.hookHelperPath ?? fileURLToPath(new URL('./hook/approve-via-agentbus.js', import.meta.url));

  return {
    id: 'cmux',
    caps: { schema: false, resume: false, tools: true },
    async run(spec: AgentSpec): Promise<AgentResult> {
      const runId = spec.escalation?.runId ?? deps.newRunId?.() ?? randomUUID();
      const sessionId = deps.newSessionId?.() ?? randomUUID();
      const policy = spec.escalation?.policy ?? DEFAULT_POLICY;
      const runDir = join(runsDir, runId);
      mkdirSync(runDir, { recursive: true });

      const hookCommand = `"${execPath}" "${hookHelperPath}"`;
      const settingsFile = writeApprovalSettings({ runDir, runId, nagiInstance, policy, hookCommand });

      const systemPrompt = composeSystemPrompt(spec.instructions, agentbusDirective(runId, nagiInstance));
      const args = buildClaudeArgs({
        sessionId,
        settingsFile,
        systemPrompt,
        prompt: spec.prompt,
        model: spec.model,
        addDir: spec.cwd,
      });
      const scriptPath = join(runDir, 'launch.sh');
      writeFileSync(scriptPath, launcherScript(claudeBin, args));

      const surface = await launch({ cwd: spec.cwd, command: `bash ${shellQuote(scriptPath)}` });
      const result = await deps.awaitResult(runId);
      const usage = readUsage(sessionId) ?? { inputTokens: 0, outputTokens: 0 };

      return {
        text: result.text,
        raw: { surface, runId, sessionId },
        usage,
        sessionId,
      };
    },
  };
}
