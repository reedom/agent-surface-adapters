import { describe, expect, it } from 'vitest';
import { makeCmuxClaudeAdapter } from '../src/presets.js';

describe('makeCmuxClaudeAdapter', () => {
  it('returns an adapter with id cmux and schema-capable caps', () => {
    const adapter = makeCmuxClaudeAdapter({ awaitResult: async () => ({ text: '' }) });
    expect(adapter.id).toBe('cmux');
    expect(adapter.caps).toEqual({ schema: true, resume: false, tools: true });
  });
});
