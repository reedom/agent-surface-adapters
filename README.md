# cmux-claude-adapter

An [`ai-workflow-engine`](../ai-workflow-engine) `CliAdapter` that runs **interactive**
`claude` (not `claude -p`) on a fresh [cmux](https://github.com/manaflow-ai/cmux)
surface and wires it to the [agentbus](../agentbus) message bus for progress,
tool-approval round-trips, and the final result.

Design: `docs/superpowers/specs/2026-06-13-cmux-surfaced-agents-design.md`.
Phase 1 plan: `docs/superpowers/plans/2026-06-13-cmux-claude-adapter-phase1.md`.

## How it works

`run(spec)` writes a persistent per-run dir (`~/.cmux-claude-adapter/runs/<runId>/`)
with a Claude `settings.json` that installs a `PreToolUse` hook, plus a `launch.sh`.
It launches `cmux new-workspace --command "bash launch.sh"` so only the script path
crosses the terminal — all agent data flows over agentbus. The adapter then blocks
on an injected `awaitResult(runId)`, which the single agentbus consumer resolves when
the agent sends `{type:"result",runId}` to `nagi`. Token usage is read from the
session transcript.

Approvals are deterministic: the `PreToolUse` hook calls `agentbus ask nagi` and maps
the `{behavior}` reply to Claude's permission decision (waits up to the 24h ceiling).

## Usage

```ts
import { makeCmuxClaudeAdapter } from 'cmux-claude-adapter';

const adapter = makeCmuxClaudeAdapter({
  // Resolved by the single nagi consumer when the run's result message arrives:
  awaitResult: (runId) => pendingRuns.await(runId),
});
// inject into the engine:
runWorkflow(mod, { adapters: { claude, codex, cmux: adapter }, /* ... */ });
// inside a workflow body: wf.agent(task, { cli: 'cmux' })
```

## Develop

```sh
pnpm install
pnpm test          # unit tests, no cmux/agentbus needed
pnpm build
pnpm smoke "<task>" "$PWD"   # real cmux + agentbus integration check
```

Smoke prerequisites: the cmux app running with a reachable `CMUX_SOCKET_PATH`,
and `claude` + `agentbus` on `PATH`.

## Status

Phase 1: adapter + approval hook + smoke (this package). Phase 2 (nagi
agentbus↔Slack bridge + `surface` workflow) lives in the `nagi` repo.
