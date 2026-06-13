import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findTranscript, readUsage } from '../src/agents/claude/result.js';

let base: string;
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'proj-'));
  const projectDir = join(base, '-repo-some-path');
  mkdirSync(projectDir, { recursive: true });
  const lines = [
    JSON.stringify({ type: 'user', message: { role: 'user' } }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', usage: { input_tokens: 10, output_tokens: 5 } } }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', usage: { input_tokens: 30, output_tokens: 12 } } }),
  ].join('\n');
  writeFileSync(join(projectDir, 'sess-abc.jsonl'), `${lines}\n`);
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

describe('findTranscript', () => {
  it('finds the transcript by session id under any project dir', () => {
    expect(findTranscript('sess-abc', { projectsDir: base })).toContain('sess-abc.jsonl');
  });
  it('returns null when missing', () => {
    expect(findTranscript('nope', { projectsDir: base })).toBeNull();
  });
});

describe('readUsage', () => {
  it('returns the last assistant usage', () => {
    expect(readUsage('sess-abc', { projectsDir: base })).toEqual({ inputTokens: 30, outputTokens: 12 });
  });
  it('returns null when no transcript', () => {
    expect(readUsage('nope', { projectsDir: base })).toBeNull();
  });
});
