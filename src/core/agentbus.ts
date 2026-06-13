import { runProcess, type RunFn } from './run.js';

export interface Envelope {
  id: string;
  kind: string;
  from: string;
  to?: string;
  payload: { type?: string; [k: string]: unknown };
}

export interface Decision {
  behavior: 'allow' | 'deny';
  reason?: string;
}

export interface AgentbusOpts {
  bin?: string;
  runner?: RunFn;
}

function bin(opts: AgentbusOpts): string {
  return opts.bin ?? 'agentbus';
}
function runner(opts: AgentbusOpts): RunFn {
  return opts.runner ?? runProcess;
}

export function parseAskReply(stdout: string): Decision {
  try {
    const env = JSON.parse(stdout) as { payload?: { behavior?: string; reason?: string } };
    const reply = env.payload ?? {};
    const reason = typeof reply.reason === 'string' ? reply.reason : undefined;
    if (reply.behavior === 'allow') return { behavior: 'allow', reason };
    return { behavior: 'deny', reason: reason ?? 'denied' };
  } catch {
    return { behavior: 'deny', reason: 'unparseable reply' };
  }
}

export async function askApproval(
  to: string,
  from: string,
  timeoutMs: number,
  payload: unknown,
  opts: AgentbusOpts = {},
): Promise<Decision> {
  const r = await runner(opts)(
    bin(opts),
    ['ask', to, '--from', from, '--timeout-ms', String(timeoutMs)],
    { input: JSON.stringify(payload) },
  );
  if (r.code !== 0) return { behavior: 'deny', reason: `ask failed: ${r.stderr.trim().slice(0, 200)}` };
  return parseAskReply(r.stdout);
}

export async function awaitInbox(id: string, timeoutMs: number, opts: AgentbusOpts = {}): Promise<Envelope[]> {
  const r = await runner(opts)(bin(opts), ['await', id, '--timeout-ms', String(timeoutMs)]);
  if (r.code !== 0) return [];
  try {
    return (JSON.parse(r.stdout).envelopes ?? []) as Envelope[];
  } catch {
    return [];
  }
}

export async function send(to: string, from: string, payload: unknown, opts: AgentbusOpts = {}): Promise<void> {
  const r = await runner(opts)(bin(opts), ['send', to, '--from', from], { input: JSON.stringify(payload) });
  if (r.code !== 0) throw new Error(`agentbus send failed: ${r.stderr.trim().slice(0, 200)}`);
}

export async function reply(askId: string, from: string, payload: unknown, opts: AgentbusOpts = {}): Promise<void> {
  const r = await runner(opts)(bin(opts), ['reply', askId, from], { input: JSON.stringify(payload) });
  if (r.code !== 0) throw new Error(`agentbus reply failed: ${r.stderr.trim().slice(0, 200)}`);
}

export async function register(
  id: string,
  opts: AgentbusOpts & { persistent?: boolean; pid?: number } = {},
): Promise<void> {
  const args = ['register', id];
  if (opts.persistent) args.push('--persistent');
  if (opts.pid !== undefined) args.push('--pid', String(opts.pid));
  const r = await runner(opts)(bin(opts), args);
  if (r.code !== 0) throw new Error(`agentbus register failed: ${r.stderr.trim().slice(0, 200)}`);
}
