import type { AgentUsage, EscalationPolicy, PermissionMode } from 'ai-workflow-engine';

export interface SurfaceRef {
  raw: string;
  ref?: string;
}

export interface SurfaceMeta {
  name?: string;
  description?: string;
}

export interface SurfaceHost {
  readonly id: string;
  launch(input: { cwd?: string; command: string }): Promise<SurfaceRef>;
  createWorkspace?(input: { cwd?: string; command: string; meta?: SurfaceMeta }): Promise<{ workspace: SurfaceRef; surface: SurfaceRef }>;
  addSurface?(input: { workspaceRef: string; cwd?: string; command: string }): Promise<SurfaceRef>;
  setMeta?(workspaceRef: string, meta: SurfaceMeta): Promise<void>;
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
  permissionMode?: PermissionMode;
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
    sessionId: string;
    nagiInstance: string;
    policy: EscalationPolicy;
    /** Path to the declared JSON Schema file; when set, the Stop hook validates against it. */
    schemaPath?: string;
    /** Max Stop-hook repair rounds before the run is reported failed. */
    maxRepairs?: number;
  }): string;
  /** Token usage from the agent's session transcript, or null. */
  readUsage(sessionId: string, cwd?: string): AgentUsage | null;
}
