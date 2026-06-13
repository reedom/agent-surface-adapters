// Presets
export { makeCmuxClaudeAdapter } from './presets.js';
export type { CmuxClaudeOptions } from './presets.js';
// Generic factory + interfaces
export { makeSurfaceAdapter } from './core/adapter.js';
export type { SurfaceAdapterDeps } from './core/adapter.js';
export type { SurfaceHost, SurfaceRef, AgentProfile, AgentBuildInput } from './core/types.js';
// Hosts & agents
export { makeCmuxHost } from './hosts/cmux.js';
export { makeClaudeProfile } from './agents/claude/profile.js';
// agentbus + consumer + runner utilities
export { register, send, awaitInbox, reply, askApproval, parseAskReply } from './core/agentbus.js';
export type { Envelope, Decision, AgentbusOpts } from './core/agentbus.js';
export { startConsumer, consumeOnce } from './core/consumer.js';
export type { ConsumerHandlers, ConsumerLoop } from './core/consumer.js';
export { runProcess } from './core/run.js';
export type { RunFn, RunResult, RunOpts } from './core/run.js';
export { agentbusDirective, composeSystemPrompt } from './core/prompt.js';
export { launcherScript, shellQuote } from './core/launcher.js';
