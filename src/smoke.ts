import { register } from './core/agentbus.js';
import { startConsumer } from './core/consumer.js';
import { makeCmuxClaudeAdapter } from './presets.js';
import type { Envelope } from './core/agentbus.js';

// Usage: pnpm smoke "<task prompt>" [cwd]
//
// Env:
//   AGENT_SCHEMA  - a JSON Schema string; when set, the run declares it, so the Stop
//                   hook validates the agent's final message and repairs on mismatch,
//                   and the result carries structured `data`.
//   MAX_REPAIRS   - cap on Stop-hook repair rounds (default 3).
//   CMUX_SOCKET / CMUX_WINDOW / CMUX_PASSWORD - cmux host options if your setup needs them.
async function main(): Promise<void> {
  const task = process.argv[2] ?? 'Run `pwd` with the Bash tool, then report the directory as your result.';
  const cwd = process.argv[3] ?? process.cwd();
  const nagiInstance = 'nagi';
  const schema = process.env['AGENT_SCHEMA'] ? (JSON.parse(process.env['AGENT_SCHEMA']) as unknown) : undefined;
  const maxRepairs = process.env['MAX_REPAIRS'] ? Number(process.env['MAX_REPAIRS']) : undefined;

  await register(nagiInstance, { persistent: true });

  // runId -> resolver for the awaited result
  const pending = new Map<string, (r: { text: string; data?: unknown }) => void>();
  const consumer = startConsumer(
    nagiInstance,
    {
      onApproval: async (env: Envelope) => {
        console.log(`[approval] ${JSON.stringify(env.payload)} -> allow`);
        return { behavior: 'allow' };
      },
      onProgress: (env: Envelope) => console.log(`[progress] ${String(env.payload.text ?? '')}`),
      onResult: (env: Envelope) => {
        const runId = String(env.payload.runId ?? '');
        console.log(`[result] runId=${runId} text=${String(env.payload.text ?? '')}`);
        if (env.payload['data'] !== undefined) console.log(`[result.data] ${JSON.stringify(env.payload['data'])}`);
        if (env.payload['error'] !== undefined) console.log(`[result.error] ${String(env.payload['error'])}`);
        pending.get(runId)?.({ text: String(env.payload.text ?? ''), data: env.payload['data'] });
      },
    },
    { intervalMs: 1000 },
  );

  const adapter = makeCmuxClaudeAdapter({
    nagiInstance,
    ...(maxRepairs !== undefined ? { maxRepairs } : {}),
    ...(process.env['CMUX_SOCKET'] ? { cmuxSocketPath: process.env['CMUX_SOCKET'] } : {}),
    ...(process.env['CMUX_WINDOW'] ? { cmuxWindow: process.env['CMUX_WINDOW'] } : {}),
    ...(process.env['CMUX_PASSWORD'] ? { cmuxPassword: process.env['CMUX_PASSWORD'] } : {}),
    awaitResult: (runId: string) =>
      new Promise<{ text: string; data?: unknown }>((resolve) => pending.set(runId, resolve)),
  });

  console.log(`[smoke] launching surface for task: ${task}${schema ? ' (with schema)' : ''}`);
  const result = await adapter.run({ prompt: task, cwd, ...(schema !== undefined ? { schema } : {}) });
  console.log(`[smoke] adapter returned:`, JSON.stringify(result, null, 2));

  consumer.stop();
  process.exit(0);
}

main().catch((err) => {
  console.error('[smoke] failed:', err);
  process.exit(1);
});
