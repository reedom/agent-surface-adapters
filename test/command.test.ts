import { describe, expect, it } from 'vitest';
import { buildClaudeArgs } from '../src/agents/claude/command.js';

describe('buildClaudeArgs', () => {
  it('builds interactive args with session, settings, system prompt and prompt', () => {
    const args = buildClaudeArgs({
      sessionId: 'sess-1',
      settingsFile: '/run/settings.json',
      systemPrompt: 'SYS',
      prompt: 'do the thing',
    });
    expect(args).toContain('--session-id');
    expect(args).toContain('sess-1');
    expect(args).toContain('--settings');
    expect(args).toContain('/run/settings.json');
    expect(args).toContain('--append-system-prompt');
    expect(args).not.toContain('-p');
    expect(args[args.length - 2]).toBe('--');
    expect(args[args.length - 1]).toBe('do the thing');
  });

  it('adds model and add-dir only when provided', () => {
    const withExtras = buildClaudeArgs({
      sessionId: 's', settingsFile: 'f', systemPrompt: 'y', prompt: 'p',
      model: 'opus', addDir: '/repo',
    });
    expect(withExtras).toContain('--model');
    expect(withExtras).toContain('opus');
    expect(withExtras).toContain('--add-dir');
    expect(withExtras).toContain('/repo');
    const without = buildClaudeArgs({ sessionId: 's', settingsFile: 'f', systemPrompt: 'y', prompt: 'p' });
    expect(without).not.toContain('--model');
    expect(without).not.toContain('--add-dir');
  });
});
