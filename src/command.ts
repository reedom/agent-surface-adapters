export interface ClaudeArgsInput {
  sessionId: string;
  settingsFile: string;
  systemPrompt: string;
  prompt: string;
  model?: string;
  addDir?: string;
}

export function buildClaudeArgs(input: ClaudeArgsInput): string[] {
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

export function shellQuote(arg: string): string {
  const escaped = arg.replaceAll("'", `'\\''`);
  return `'${escaped}'`;
}

export function launcherScript(bin: string, args: string[]): string {
  const line = [bin, ...args].map(shellQuote).join(' ');
  return `#!/usr/bin/env bash\nexec ${line}\n`;
}
