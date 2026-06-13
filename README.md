# agent-surface-adapters

[`ai-workflow-engine`](../ai-workflow-engine) `CliAdapter`s that run **interactive**
agent CLIs (not headless `-p`) on a fresh terminal **surface**, wired to the
[agentbus](../agentbus) message bus for progress, tool-approval round-trips, and
the final result.

Two independent axes:

- **Surface host** — where the agent runs (cmux today; tmux/others later)
- **Agent CLI** — what runs (claude today; codex/others later)

The first combination — **claude on a cmux surface** — is shipped as
`makeCmuxClaudeAdapter`.

Design: `docs/superpowers/specs/2026-06-13-cmux-surfaced-agents-design.md`.
Phase 1 plan: `docs/superpowers/plans/2026-06-13-cmux-claude-adapter-phase1.md`.

## How it works

`run(spec)` writes a persistent per-run dir (`~/.agent-surface-adapters/runs/<runId>/`)
with the agent's approval `settings.json` (a `PreToolUse` hook) plus a `launch.sh`.
The host launches the agent running that script (e.g. `cmux new-workspace --command
"bash launch.sh"`) so only the script path crosses the terminal — all agent data
flows over agentbus. The adapter then blocks on an injected `awaitResult(runId)`,
which the single agentbus consumer resolves when the agent sends
`{type:"result",runId}` to `nagi`. Token usage is read from the agent's session
transcript.

Approvals are deterministic: the `PreToolUse` hook calls `agentbus ask nagi` and maps
the `{behavior}` reply to the agent's permission decision (waits up to the 24h ceiling).

## Structure

```
src/
  core/    types (SurfaceHost, AgentProfile), run, agentbus, consumer,
           prompt, launcher, adapter (makeSurfaceAdapter)
  hosts/   cmux.ts            # makeCmuxHost   (add a file here for tmux, ...)
  agents/  claude/            # makeClaudeProfile (add a folder here for codex, ...)
  presets.ts                  # makeCmuxClaudeAdapter = host x agent
```

A new adapter is `makeSurfaceAdapter({ host, agent, awaitResult })`. Adding a
**host** is one file in `hosts/`; adding an **agent** is one folder in `agents/`
(its `AgentProfile` owns that CLI's arg-building, approval-settings/hook format,
and transcript/usage parsing — e.g. codex's sandbox-approval model differs from
claude's `PreToolUse` hook, which is exactly what the per-agent seam absorbs).

## Usage

```ts
import { makeCmuxClaudeAdapter } from 'agent-surface-adapters';

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
and `claude` + `agentbus` on `PATH`. The built approval hook can be checked
standalone: `echo '{}' | node dist/agents/claude/hook/approve-via-agentbus.js`
(prints a fail-safe `deny`).

## Status

Phase 1 (this package): the cmux + claude adapter, the agentbus approval hook,
and a passing real smoke (`docs/smoke-notes.md`). Phase 2 — the nagi
agentbus↔Slack bridge + `surface` workflow — lives in the `nagi` repo.
