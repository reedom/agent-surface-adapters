import type { AgentBuildInput } from '../../core/types.js';

export function buildClaudeArgs(input: AgentBuildInput): string[] {
  const args = [
    '--session-id', input.sessionId,
    '--settings', input.settingsFile,
    '--append-system-prompt', input.systemPrompt,
  ];
  if (input.model) args.push('--model', input.model);
  if (input.addDir) args.push('--add-dir', input.addDir);
  args.push('--', input.prompt);
  return args;
}
