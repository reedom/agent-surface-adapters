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

  it('emits the permission flag and keeps the prompt last', () => {
    const auto = buildClaudeArgs({ sessionId: 's', settingsFile: 'f', systemPrompt: 'y', prompt: 'p', permissionMode: 'auto' });
    expect(auto).toContain('--permission-mode');
    expect(auto[auto.indexOf('--permission-mode') + 1]).toBe('auto');
    expect(auto[auto.length - 2]).toBe('--');
    expect(auto[auto.length - 1]).toBe('p');
    const bypass = buildClaudeArgs({ sessionId: 's', settingsFile: 'f', systemPrompt: 'y', prompt: 'p', permissionMode: 'bypassPermissions' });
    expect(bypass).toContain('--dangerously-skip-permissions');
    const none = buildClaudeArgs({ sessionId: 's', settingsFile: 'f', systemPrompt: 'y', prompt: 'p' });
    expect(none).not.toContain('--permission-mode');
    expect(none).not.toContain('--dangerously-skip-permissions');
  });
});
