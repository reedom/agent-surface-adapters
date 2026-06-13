import { describe, expect, it, vi } from 'vitest';
import { consumeOnce } from '../src/core/consumer.js';
import type { RunFn } from '../src/core/run.js';

function runnerYielding(envelopes: unknown[]): RunFn {
  return vi.fn(async (_cmd: string, args: string[]) => {
    if (args[0] === 'await') return { stdout: JSON.stringify({ envelopes }), stderr: '', code: 0 };
    return { stdout: '', stderr: '', code: 0 }; // reply
  }) as unknown as RunFn;
}

describe('consumeOnce', () => {
  it('replies to an approval ask with the handler decision', async () => {
    const runner = runnerYielding([
      { id: 'ask-1', kind: 'ask', from: 'ext:awe-1', payload: { type: 'approval', runId: '1', tool: 'Bash' } },
    ]);
    const onApproval = vi.fn().mockResolvedValue({ behavior: 'allow' });
    await consumeOnce('nagi', 1000, { onApproval, onProgress: vi.fn(), onResult: vi.fn() }, { runner });
    expect(onApproval).toHaveBeenCalledOnce();
    const replyCall = (runner as any).mock.calls.find((c: any[]) => c[1][0] === 'reply');
    expect(replyCall[1].slice(0, 3)).toEqual(['reply', 'ask-1', 'nagi']);
    expect(JSON.parse(replyCall[2].input)).toEqual({ behavior: 'allow' });
  });

  it('dispatches progress and result messages without replying', async () => {
    const runner = runnerYielding([
      { id: 'm1', kind: 'message', from: 'ext:awe-1', payload: { type: 'progress', runId: '1', text: 'step' } },
      { id: 'm2', kind: 'message', from: 'ext:awe-1', payload: { type: 'result', runId: '1', text: 'done' } },
    ]);
    const onProgress = vi.fn();
    const onResult = vi.fn();
    await consumeOnce('nagi', 1000, { onApproval: vi.fn(), onProgress, onResult }, { runner });
    expect(onProgress).toHaveBeenCalledOnce();
    expect(onResult).toHaveBeenCalledOnce();
    expect((onResult.mock.calls[0][0] as any).payload.text).toBe('done');
    expect((runner as any).mock.calls.some((c: any[]) => c[1][0] === 'reply')).toBe(false);
  });
});
