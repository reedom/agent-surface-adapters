import type { AgentUsage, EscalationPolicy } from 'ai-workflow-engine';

export interface SurfaceRef {
  raw: string;
  ref?: string;
}

export interface SurfaceHost {
  readonly id: string;
  launch(input: { cwd?: string; command: string }): Promise<SurfaceRef>;
  /**
   * Type text into a live surface's REPL (no submit). Optional capability: a
   * host driving a resident interactive agent implements it; a headless host
   * has no REPL to type into and omits it. Used to feed the next instruction to
   * a resident agent (vs. the agent polling agentbus for it).
   */
  send?(surfaceRef: string, text: string): Promise<void>;
  /** Send a single key (e.g. 'Return') to a live surface, to submit input or control the REPL. */
  sendKey?(surfaceRef: string, key: string): Promise<void>;
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
