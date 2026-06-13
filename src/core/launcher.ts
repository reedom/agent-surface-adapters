export function shellQuote(arg: string): string {
  const escaped = arg.replaceAll("'", `'\\''`);
  return `'${escaped}'`;
}

export function launcherScript(bin: string, args: string[]): string {
  const line = [bin, ...args].map(shellQuote).join(' ');
  return `#!/usr/bin/env bash\nexec ${line}\n`;
}
