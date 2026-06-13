import { awaitInbox, reply, type AgentbusOpts, type Decision, type Envelope } from './agentbus.js';

export interface ConsumerHandlers {
  onApproval: (env: Envelope) => Promise<Decision>;
  onProgress: (env: Envelope) => void;
  onResult: (env: Envelope) => void;
}

export async function consumeOnce(
  instance: string,
  timeoutMs: number,
  handlers: ConsumerHandlers,
  opts: AgentbusOpts = {},
): Promise<void> {
  const envelopes = await awaitInbox(instance, timeoutMs, opts);
  for (const env of envelopes) {
    const type = env.payload?.type;
    if (env.kind === 'ask' && type === 'approval') {
      const decision = await handlers.onApproval(env);
      await reply(env.id, instance, decision, opts);
    } else if (type === 'progress') {
      handlers.onProgress(env);
    } else if (type === 'result') {
      handlers.onResult(env);
    }
  }
}

export interface ConsumerLoop {
  stop: () => void;
}

export function startConsumer(
  instance: string,
  handlers: ConsumerHandlers,
  opts: AgentbusOpts & { intervalMs?: number } = {},
): ConsumerLoop {
  let running = true;
  const loop = async () => {
    while (running) {
      try {
        await consumeOnce(instance, opts.intervalMs ?? 2000, handlers, opts);
      } catch {
        // keep looping; transient agentbus errors must not kill the consumer
      }
    }
  };
  void loop();
  return { stop: () => { running = false; } };
}
