import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface UsageDeps {
  projectsDir?: string;
}

export interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
}

function projectsBase(deps: UsageDeps): string {
  return deps.projectsDir ?? join(homedir(), '.claude', 'projects');
}

export function findTranscript(sessionId: string, deps: UsageDeps = {}): string | null {
  const base = projectsBase(deps);
  if (!existsSync(base)) return null;
  for (const dir of readdirSync(base)) {
    const candidate = join(base, dir, `${sessionId}.jsonl`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function readUsage(sessionId: string, deps: UsageDeps = {}): AgentUsage | null {
  const file = findTranscript(sessionId, deps);
  if (!file) return null;
  const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
  for (let i = lines.length - 1; 0 <= i; i--) {
    try {
      const event = JSON.parse(lines[i]) as { message?: { usage?: { input_tokens?: number; output_tokens?: number } } };
      const usage = event.message?.usage;
      if (usage && (usage.input_tokens !== undefined || usage.output_tokens !== undefined)) {
        return { inputTokens: Number(usage.input_tokens ?? 0), outputTokens: Number(usage.output_tokens ?? 0) };
      }
    } catch {
      // skip malformed lines
    }
  }
  return null;
}
