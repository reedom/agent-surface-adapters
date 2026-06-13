import { describe, expect, it } from 'vitest';
import { agentbusDirective, composeSystemPrompt } from '../src/core/prompt.js';

describe('agentbusDirective', () => {
  it('embeds the runId, recipient, and the optional progress shape', () => {
    const d = agentbusDirective('run-42', 'nagi');
    expect(d).toContain('run-42');
    expect(d).toContain('ext:awe-run-42');
    expect(d).toContain('agentbus send nagi');
    expect(d).toContain('"type":"progress"');
  });
  it('does not instruct the model to send the result (the Stop hook captures it) and forbids follow-up questions', () => {
    const d = agentbusDirective('run-42', 'nagi');
    expect(d).not.toContain('"type":"result"');
    expect(d).toMatch(/automatically captured/i);
    expect(d).toMatch(/do not ask follow-up/i);
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
