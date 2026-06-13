import type { AgentUsage, EscalationPolicy } from 'ai-workflow-engine';

export interface SurfaceRef {
  raw: string;
  ref?: string;
}

export interface SurfaceHost {
  readonly id: string;
  launch(input: { cwd?: string; command: string }): Promise<SurfaceRef>;
}

export interface AgentBuildInput {
  sessionId: string;
  settingsFile: string;
  systemPrompt: string;
  prompt: string;
  model?: string;
  addDir?: string;
}

export interface AgentProfile {
  readonly id: string;
  /** Binary to launch interactively (no -p), e.g. 'claude'. */
  readonly bin: string;
  /** Build the interactive launch args. */
  buildArgs(input: AgentBuildInput): string[];
  /** Write the per-run approval settings file; return its path. The profile owns its own hook wiring. */
  writeApprovalSettings(input: {
    runDir: string;
    runId: string;
    nagiInstance: string;
    policy: EscalationPolicy;
  }): string;
  /** Token usage from the agent's session transcript, or null. */
  readUsage(sessionId: string, cwd?: string): AgentUsage | null;
}
