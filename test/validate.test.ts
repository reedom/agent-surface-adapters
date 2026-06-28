import { describe, expect, it } from 'vitest';
import { extractJsonObject, validateAgainstSchema, type JsonSchema } from '../src/core/validate.js';

const TRIAGE: JsonSchema = {
  type: 'object',
  properties: {
    found: { type: 'boolean' },
    kind: { type: 'string', enum: ['investigation', 'bug', 'other'] },
    repoHint: { type: 'string' },
  },
  required: ['found', 'kind', 'repoHint'],
};

describe('extractJsonObject', () => {
  it('parses a bare JSON object', () => {
    expect(extractJsonObject('{"found":true}')).toEqual({ found: true });
  });
  it('pulls JSON out of a ```json fence', () => {
    expect(extractJsonObject('here:\n```json\n{"a":1}\n```\ndone')).toEqual({ a: 1 });
  });
  it('pulls JSON out of surrounding prose', () => {
    expect(extractJsonObject('The result is {"a":1,"b":2} as requested.')).toEqual({ a: 1, b: 2 });
  });
  it('returns undefined when there is no JSON object', () => {
    expect(extractJsonObject('no json here')).toBeUndefined();
    expect(extractJsonObject('{ not valid')).toBeUndefined();
  });
});

describe('validateAgainstSchema', () => {
  it('accepts a conforming object', () => {
    expect(validateAgainstSchema({ found: true, kind: 'bug', repoHint: 'x' }, TRIAGE)).toEqual({ ok: true, errors: [] });
  });
  it('reports missing required fields', () => {
    const r = validateAgainstSchema({ found: true }, TRIAGE);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/missing required "kind"/);
    expect(r.errors.join(' ')).toMatch(/missing required "repoHint"/);
  });
  it('reports a wrong property type', () => {
    const r = validateAgainstSchema({ found: 'yes', kind: 'bug', repoHint: 'x' }, TRIAGE);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/found: expected boolean/);
  });
  it('reports an out-of-enum value', () => {
    const r = validateAgainstSchema({ found: true, kind: 'nope', repoHint: 'x' }, TRIAGE);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/kind: must be one of/);
  });
  it('reports a non-object root', () => {
    expect(validateAgainstSchema('a string', TRIAGE).ok).toBe(false);
  });
});
