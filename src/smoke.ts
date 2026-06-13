import { register } from './agentbus.js';
import { startConsumer } from './consumer.js';
import { makeCmuxClaudeAdapter } from './adapter.js';
import type { Envelope } from './agentbus.js';
import { fileURLToPath } from 'node:url';

// Usage: pnpm smoke "<task prompt>" [cwd]
async function main(): Promise<void> {
  const task = process.argv[2] ?? 'Run `pwd` with the Bash tool, then report the directory as your result.';
  const cwd = process.argv[3] ?? process.cwd();
  const nagiInstance = 'nagi';

  await register(nagiInstance, { persistent: true });

  // runId -> resolver for the awaited result
  const pending = new Map<string, (text: string) => void>();
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
        pending.get(runId)?.(String(env.payload.text ?? ''));
      },
    },
    { intervalMs: 1000 },
  );

  const hookHelperPath = fileURLToPath(new URL('./hook/approve-via-agentbus.js', import.meta.url));
  const adapter = makeCmuxClaudeAdapter({
    nagiInstance,
    hookHelperPath,
    awaitResult: (runId: string) =>
      new Promise<{ text: string }>((resolve) => pending.set(runId, (text) => resolve({ text }))),
  });

  console.log(`[smoke] launching surface for task: ${task}`);
  const result = await adapter.run({ prompt: task, cwd });
  console.log(`[smoke] adapter returned:`, JSON.stringify(result, null, 2));

  consumer.stop();
  process.exit(0);
}

main().catch((err) => {
  console.error('[smoke] failed:', err);
  process.exit(1);
});
