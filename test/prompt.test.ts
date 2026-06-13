import { describe, expect, it } from 'vitest';
import { agentbusDirective, composeSystemPrompt } from '../src/prompt.js';

describe('agentbusDirective', () => {
  it('embeds the runId, recipient, and both message shapes', () => {
    const d = agentbusDirective('run-42', 'nagi');
    expect(d).toContain('run-42');
    expect(d).toContain('ext:awe-run-42');
    expect(d).toContain('agentbus send nagi');
    expect(d).toContain('"type":"progress"');
    expect(d).toContain('"type":"result"');
  });
});

describe('composeSystemPrompt', () => {
  it('returns the directive alone when no instructions', () => {
    expect(composeSystemPrompt(undefined, 'DIR')).toBe('DIR');
  });
  it('prefixes caller instructions before the directive', () => {
    expect(composeSystemPrompt('INST', 'DIR')).toBe('INST\n\nDIR');
  });
});
