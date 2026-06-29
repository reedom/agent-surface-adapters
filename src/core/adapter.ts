import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AgentResult, AgentSpec, CliAdapter, EscalationPolicy } from 'ai-workflow-engine';
import type { AgentProfile, SurfaceHost, SurfaceRef } from './types.js';
import { agentbusDirective, composeSystemPrompt, schemaDirective } from './prompt.js';
import { launcherScript, shellQuote } from './launcher.js';

const DEFAULT_POLICY: EscalationPolicy = { timeoutMs: 86_400_000, onTimeout: 'wait' };

export interface SurfaceAdapterDeps {
  host: SurfaceHost;
  agent: AgentProfile;
  /** Resolved by the single nagi consumer when this run's result message arrives. REQUIRED. */
  awaitResult: (runId: string) => Promise<{ text: string; data?: unknown; error?: string }>;
  /** Max Stop-hook repair rounds when a schema is declared (default handled downstream). */
  maxRepairs?: number;
  /** Engine cli key under which this adapter is registered. Defaults to the host id. */
  id?: string;
  nagiInstance?: string;
  /** Persistent per-run dir root (default ~/.agent-surface-adapters/runs). NOT cleaned up. */
  runsDir?: string;
  newRunId?: () => string;
  newSessionId?: () => string;
  /** Invoked with the surface ref as soon as it is launched (before the result arrives), so the caller can target it for cancellation/close. */
  onSurface?: (surface: SurfaceRef) => void;
}

export function makeSurfaceAdapter(deps: SurfaceAdapterDeps): CliAdapter {
  const nagiInstance = deps.nagiInstance ?? 'nagi';
  const runsDir = deps.runsDir ?? join(homedir(), '.agent-surface-adapters', 'runs');
  const id = deps.id ?? deps.host.id;

  return {
    // schema: structured output is supported via prompt delivery + Stop-hook validation
    // (not a native CLI flag), so the consumer can rely on result.data when it declares one.
    id,
    caps: { schema: true, resume: false, tools: true },
    async run(spec: AgentSpec): Promise<AgentResult> {
      const runId = spec.escalation?.runId ?? deps.newRunId?.() ?? randomUUID();
      const sessionId = deps.newSessionId?.() ?? randomUUID();
      const policy = spec.escalation?.policy ?? DEFAULT_POLICY;
      const runDir = join(runsDir, runId);
      mkdirSync(runDir, { recursive: true });

      // When the workflow declares a schema, deliver it both to the agent (in the
      // system prompt) and to the Stop hook (a per-run file, recorded in meta) so
      // the hook can validate the final message and drive repair.
      let schemaPath: string | undefined;
      if (spec.schema !== undefined) {
        schemaPath = join(runDir, 'schema.json');
        writeFileSync(schemaPath, JSON.stringify(spec.schema));
      }

      const settingsFile = deps.agent.writeApprovalSettings({
        runDir,
        runId,
        sessionId,
        nagiInstance,
        policy,
        ...(schemaPath !== undefined ? { schemaPath } : {}),
        ...(deps.maxRepairs !== undefined ? { maxRepairs: deps.maxRepairs } : {}),
      });
      const directive =
        spec.schema !== undefined
          ? `${agentbusDirective(runId, nagiInstance)}\n\n${schemaDirective(spec.schema)}`
          : agentbusDirective(runId, nagiInstance);
      const systemPrompt = composeSystemPrompt(spec.instructions, directive);
      const args = deps.agent.buildArgs({
        sessionId,
        settingsFile,
        systemPrompt,
        prompt: spec.prompt,
        model: spec.model,
        addDir: spec.cwd,
        ...(spec.permissionMode !== undefined ? { permissionMode: spec.permissionMode } : {}),
      });
      const scriptPath = join(runDir, 'launch.sh');
      writeFileSync(scriptPath, launcherScript(deps.agent.bin, args));

      const surface = await deps.host.launch({ cwd: spec.cwd, command: `bash ${shellQuote(scriptPath)}` });
      deps.onSurface?.(surface);
      const result = await deps.awaitResult(runId);
      // A reported `error` (e.g. schema validation failed after all repairs) is the run's
      // real failure cause — throw it so the workflow step fails with that message rather
      // than a downstream undefined-data artifact.
      if (result.error !== undefined) throw new Error(result.error);
      const usage = deps.agent.readUsage(sessionId, spec.cwd) ?? { inputTokens: 0, outputTokens: 0 };

      return {
        text: result.text,
        ...(result.data !== undefined ? { data: result.data } : {}),
        raw: { surface, runId, sessionId },
        usage,
        sessionId,
      };
    },
  };
}
