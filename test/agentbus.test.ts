import { describe, expect, it, vi } from 'vitest';
import { askApproval, awaitInbox, parseAskReply, register, reply, send } from '../src/agentbus.js';
import type { RunFn } from '../src/run.js';

const ok = (stdout = '') => ({ stdout, stderr: '', code: 0 });

describe('parseAskReply', () => {
  it('reads allow from the reply envelope payload', () => {
    expect(parseAskReply('{"payload":{"behavior":"allow","reason":"ok"}}')).toEqual({ behavior: 'allow', reason: 'ok' });
  });
  it('treats anything else as deny', () => {
    expect(parseAskReply('{"payload":{"behavior":"deny"}}')).toEqual({ behavior: 'deny', reason: 'denied' });
    expect(parseAskReply('not json')).toEqual({ behavior: 'deny', reason: 'unparseable reply' });
  });
});

describe('askApproval', () => {
  it('invokes `agentbus ask` with from/timeout and pipes the payload', async () => {
    const runner = vi.fn() as unknown as RunFn;
    vi.mocked(runner).mockResolvedValue(ok('{"payload":{"behavior":"allow"}}'));
    const decision = await askApproval('nagi', 'ext:awe-1', 86_400_000, { type: 'approval', runId: '1' }, { runner });
    expect(decision.behavior).toBe('allow');
    const [cmd, args, opts] = vi.mocked(runner).mock.calls[0];
    expect(cmd).toBe('agentbus');
    expect(args.slice(0, 2)).toEqual(['ask', 'nagi']);
    expect(args).toContain('--from');
    expect(args).toContain('ext:awe-1');
    expect(args).toContain('--timeout-ms');
    expect(args).toContain('86400000');
    expect(JSON.parse(opts!.input!)).toEqual({ type: 'approval', runId: '1' });
  });
  it('denies when the CLI exits non-zero', async () => {
    const runner = vi.fn() as unknown as RunFn;
    vi.mocked(runner).mockResolvedValue({ stdout: '', stderr: 'boom', code: 2 });
    expect((await askApproval('nagi', 'f', 1, {}, { runner })).behavior).toBe('deny');
  });
});

describe('awaitInbox', () => {
  it('returns the envelopes array', async () => {
    const runner = vi.fn() as unknown as RunFn;
    vi.mocked(runner).mockResolvedValue(ok('{"envelopes":[{"id":"a","kind":"message","from":"x","payload":{"type":"progress"}}]}'));
    const envs = await awaitInbox('nagi', 1000, { runner });
    expect(envs).toHaveLength(1);
    expect(envs[0].payload.type).toBe('progress');
    expect(vi.mocked(runner).mock.calls[0][1]).toEqual(['await', 'nagi', '--timeout-ms', '1000']);
  });
  it('returns [] on non-zero exit', async () => {
    const runner = vi.fn() as unknown as RunFn;
    vi.mocked(runner).mockResolvedValue({ stdout: '', stderr: '', code: 1 });
    expect(await awaitInbox('nagi', 1, { runner })).toEqual([]);
  });
});

describe('send / reply / register', () => {
  it('send pipes payload to `agentbus send`', async () => {
    const runner = vi.fn() as unknown as RunFn;
    vi.mocked(runner).mockResolvedValue(ok());
    await send('nagi', 'ext:awe-1', { type: 'result', text: 'done' }, { runner });
    const [cmd, args, opts] = vi.mocked(runner).mock.calls[0];
    expect([cmd, args.slice(0, 2)]).toEqual(['agentbus', ['send', 'nagi']]);
    expect(JSON.parse(opts!.input!)).toEqual({ type: 'result', text: 'done' });
  });
  it('reply targets the ask id and the answerer instance', async () => {
    const runner = vi.fn() as unknown as RunFn;
    vi.mocked(runner).mockResolvedValue(ok());
    await reply('ask-9', 'nagi', { behavior: 'allow' }, { runner });
    expect(vi.mocked(runner).mock.calls[0][1].slice(0, 3)).toEqual(['reply', 'ask-9', 'nagi']);
  });
  it('register passes --persistent', async () => {
    const runner = vi.fn() as unknown as RunFn;
    vi.mocked(runner).mockResolvedValue(ok());
    await register('nagi', { persistent: true, runner });
    expect(vi.mocked(runner).mock.calls[0][1]).toEqual(['register', 'nagi', '--persistent']);
  });
});
