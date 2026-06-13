import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lastAssistantText, runResultHook } from '../src/agents/claude/hook/report-result-via-agentbus.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'res-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function writeTranscript(name: string, lines: unknown[]): string {
  const p = join(dir, name);
  writeFileSync(p, lines.map((l) => JSON.stringify(l)).join('\n'));
  return p;
}

describe('lastAssistantText', () => {
  it('returns the last assistant text block, ignoring later non-assistant events', () => {
    const p = writeTranscript('t.jsonl', [
      { type: 'user', message: { role: 'user', content: 'do it' } },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'first answer' }] } },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash' }, { type: 'text', text: 'final answer' }] } },
      { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } },
    ]);
    expect(lastAssistantText(p)).toBe('final answer');
  });
  it('handles string content and returns null when there is no assistant text', () => {
    expect(lastAssistantText(writeTranscript('s.jsonl', [{ type: 'assistant', message: { role: 'assistant', content: 'plain string answer' } }]))).toBe('plain string answer');
    expect(lastAssistantText(writeTranscript('n.jsonl', [{ type: 'user', message: { role: 'user', content: 'hi' } }]))).toBeNull();
  });
  it('returns null for a missing transcript', () => {
    expect(lastAssistantText(join(dir, 'nope.jsonl'))).toBeNull();
  });
});

describe('runResultHook', () => {
  function metaFile(): string {
    const p = join(dir, 'meta.json');
    writeFileSync(p, JSON.stringify({ runId: 'run-9', nagiInstance: 'nagi', timeoutMs: 86_400_000 }));
    return p;
  }

  it('sends the last assistant message as the run result over agentbus and allows stop', async () => {
    const transcript = writeTranscript('t.jsonl', [
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'the answer' }] } },
    ]);
    const send = vi.fn(async () => {});
    const out = JSON.parse(
      await runResultHook(['--meta', metaFile()], JSON.stringify({ transcript_path: transcript }), { send }),
    );
    expect(send).toHaveBeenCalledWith('nagi', 'ext:awe-run-9', { type: 'result', runId: 'run-9', text: 'the answer' });
    expect(out.decision).toBeUndefined(); // no block => agent is allowed to stop
  });

  it('reports an empty result when no assistant text is found (never silently skips)', async () => {
    const send = vi.fn(async () => {});
    await runResultHook(['--meta', metaFile()], JSON.stringify({ transcript_path: join(dir, 'missing.jsonl') }), { send });
    expect(send).toHaveBeenCalledWith('nagi', 'ext:awe-run-9', { type: 'result', runId: 'run-9', text: '' });
  });
});
