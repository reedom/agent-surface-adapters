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
  const noSleep = async (): Promise<void> => {};
  function metaFile(): string {
    const p = join(dir, 'meta.json');
    writeFileSync(p, JSON.stringify({ runId: 'run-9', sessionId: 'sess-9', nagiInstance: 'nagi', timeoutMs: 86_400_000 }));
    return p;
  }

  it('sends the last assistant message as the run result over agentbus and allows stop', async () => {
    const transcript = writeTranscript('t.jsonl', [
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'the answer' }] } },
    ]);
    const send = vi.fn(async () => {});
    const out = JSON.parse(
      await runResultHook(['--meta', metaFile()], JSON.stringify({ transcript_path: transcript }), { send, sleep: noSleep }),
    );
    expect(send).toHaveBeenCalledWith('nagi', 'ext:awe-run-9', { type: 'result', runId: 'run-9', text: 'the answer' });
    expect(out.decision).toBeUndefined(); // no block => agent is allowed to stop
  });

  it('falls back to resolving the transcript by sessionId when transcript_path is absent', async () => {
    const transcript = writeTranscript('by-session.jsonl', [
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'resolved by session' }] } },
    ]);
    const findTranscript = vi.fn((sessionId: string) => (sessionId === 'sess-9' ? transcript : null));
    const send = vi.fn(async () => {});
    await runResultHook(['--meta', metaFile()], JSON.stringify({}), { send, findTranscript, sleep: noSleep });
    expect(findTranscript).toHaveBeenCalledWith('sess-9');
    expect(send).toHaveBeenCalledWith('nagi', 'ext:awe-run-9', { type: 'result', runId: 'run-9', text: 'resolved by session' });
  });

  it('reports an empty result when no assistant text is found anywhere (never silently skips)', async () => {
    const send = vi.fn(async () => {});
    await runResultHook(
      ['--meta', metaFile()],
      JSON.stringify({ transcript_path: join(dir, 'missing.jsonl') }),
      { send, findTranscript: () => null, sleep: noSleep },
    );
    expect(send).toHaveBeenCalledWith('nagi', 'ext:awe-run-9', { type: 'result', runId: 'run-9', text: '' });
  });
});

describe('runResultHook — schema validation + repair', () => {
  const noSleep = async (): Promise<void> => {};
  const schema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] };
  function schemaMeta(extra: Record<string, unknown> = {}): string {
    const p = join(dir, 'meta.json');
    writeFileSync(
      p,
      JSON.stringify({ runId: 'run-9', sessionId: 'sess-9', nagiInstance: 'nagi', timeoutMs: 1, schemaPath: join(dir, 'schema.json'), ...extra }),
    );
    writeFileSync(join(dir, 'schema.json'), JSON.stringify(schema));
    return p;
  }
  function transcriptWith(text: string): string {
    return writeTranscript('t.jsonl', [
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } },
    ]);
  }

  it('sends structured data and allows stop when the final JSON validates', async () => {
    const send = vi.fn(async () => {});
    const out = JSON.parse(
      await runResultHook(['--meta', schemaMeta()], JSON.stringify({ transcript_path: transcriptWith('{"ok":true}') }), { send, sleep: noSleep }),
    );
    expect(send).toHaveBeenCalledWith('nagi', 'ext:awe-run-9', { type: 'result', runId: 'run-9', text: '{"ok":true}', data: { ok: true } });
    expect(out.decision).toBeUndefined();
  });

  it('blocks the stop with repair feedback when the final JSON is invalid (under the cap)', async () => {
    const send = vi.fn(async () => {});
    let attempts = 0;
    const out = JSON.parse(
      await runResultHook(['--meta', schemaMeta({ maxRepairs: 2 })], JSON.stringify({ transcript_path: transcriptWith('{"ok":"nope"}') }), {
        send,
        sleep: noSleep,
        readAttempts: () => attempts,
        writeAttempts: (_d, n) => { attempts = n; },
      }),
    );
    expect(out.decision).toBe('block');
    expect(out.hookSpecificOutput.additionalContext).toMatch(/expected boolean/);
    expect(attempts).toBe(1); // counter advanced
    expect(send).not.toHaveBeenCalled(); // no result sent while repairing
  });

  it('reports a failed result once repairs are exhausted (so the run unblocks)', async () => {
    const send = vi.fn(async () => {});
    const out = JSON.parse(
      await runResultHook(['--meta', schemaMeta({ maxRepairs: 2 })], JSON.stringify({ transcript_path: transcriptWith('not json at all') }), {
        send,
        sleep: noSleep,
        readAttempts: () => 2, // already at the cap
        writeAttempts: () => {},
      }),
    );
    expect(out.decision).toBeUndefined(); // allow stop
    const payload = send.mock.calls[0][2];
    expect(payload.type).toBe('result');
    expect(payload.data).toBeUndefined();
    expect(payload.error).toMatch(/schema validation failed/);
  });
});
