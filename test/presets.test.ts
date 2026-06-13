import { describe, expect, it } from 'vitest';
import { makeCmuxClaudeAdapter } from '../src/presets.js';

describe('makeCmuxClaudeAdapter', () => {
  it('returns an adapter with id cmux and non-schema caps', () => {
    const adapter = makeCmuxClaudeAdapter({ awaitResult: async () => ({ text: '' }) });
    expect(adapter.id).toBe('cmux');
    expect(adapter.caps).toEqual({ schema: false, resume: false, tools: true });
  });
});
