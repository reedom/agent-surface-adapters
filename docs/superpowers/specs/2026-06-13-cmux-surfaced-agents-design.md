# Design: cmux-claude-adapter — surfaced interactive agents over agentbus

Date: 2026-06-13
Status: DRAFT (awaiting user review)
Repos: `reedom/cmux-claude-adapter` (new, primary), `reedom/nagi` (Phase 2 integration)
Depends on: `ai-workflow-engine` (types only), `agentbus` CLI, `cmux` CLI, `claude` CLI

## Problem / motivation

nagi runs workflow agents through the engine's `CliAdapter`s. The `claude`
adapter spawns `claude -p` (headless/print) and parses JSON. Two pressures push
toward a different execution path:

1. **Cost.** Anthropic has signalled a possible price increase for `claude -p`
   (headless) usage. Running `claude` as a normal interactive CLI avoids that
   path. *(Premise — load-bearing for the cost rationale; the visibility and
   bus-unification value below stand on their own if the pricing assumption
   changes.)*
2. **Visibility / control.** An interactive `claude` on a cmux surface is one
   you can watch and jump into mid-run, instead of an opaque headless process.

The vehicle is a new `CliAdapter` that launches interactive `claude` on a fresh
cmux surface and wires it to **agentbus** — the existing daemonless local
message bus (`reedom/agentbus`) — for progress, tool-approval round-trips, and
the final result. nagi becomes the single agentbus-to-Slack bridge for that
agent-side traffic.

## Scope

Chosen sequencing: **cmux-slice first** (decision B).

- **In scope:** the `cmux-claude-adapter` package (a `CliAdapter`); the
  agentbus message contract for agent-side traffic; nagi's agentbus-to-Slack
  bridge for that traffic; one trigger for a surfaced run.
- **Unchanged:** human Slack ingress stays exactly as today (Bolt socket-mode).
  Only **agent-side and egress** traffic moves onto agentbus.
- **Explicitly deferred:** re-platforming nagi's *human ingress* onto agentbus
  (the general "any channel: Slack, HTTP/2, …" front door is a later spec);
  claude-teams internal-team splits; `claude --remote-control` driving;
  configurable surface auto-close; many concurrent surfaces and watcher
  hardening; a crash-recovery journal for surfaced runs.

## Key decisions (locked)

- **Standalone package.** `cmux-claude-adapter` implements the engine's
  `CliAdapter` and depends only on engine *types* plus the `cmux`/`agentbus`
  CLIs. It contains no Slack knowledge.
- **agentbus is the single agent-side channel.** The agent **sends with
  `--from ext:awe-<runId>`** (matching the engine's existing convention) and
  **needs no registration** — only recipients register. **nagi registers
  `nagi`** (persistent) and is the sole consumer via `agentbus watch nagi`,
  which live-streams every envelope addressed to it.
- **Three message kinds, all addressed to `nagi`:**
  - progress → `message` `{type:"progress", runId, agentLabel, text}`
  - approval → `ask` `{type:"approval", runId, tool, input, cwd}`
  - result → `message` `{type:"result", runId, text}`
- **Approval is deterministic, not agent-voluntary.** The adapter installs a
  Claude `PreToolUse` hook (via `--settings`) that runs `agentbus ask nagi …`
  and maps the `{behavior:"allow"|"deny"}` reply to Claude's permission
  decision. The hook loops up to the policy ceiling (24h for `wait`).
- **Completion is the explicit `result` message** — never process exit, never
  transcript-idle heuristics.
- **Token usage** is read from Claude's session transcript JSONL, located
  deterministically via `--session-id`; falls back to zeros if absent.
- **Surface stays open** after completion for MVP (you ran interactive to be
  able to inspect it). Auto-close becomes configurable later.
- **Injectable seams** mirror `makeClaudeAdapter({spawnFn})`: the adapter takes
  `launchSurface`, `awaitResult`, `readUsage`, and `writeApprovalSettings`, with
  real CLI-backed defaults, so unit tests need no live cmux/agentbus.

## Architecture

```
                       (human ingress unchanged: Slack Bolt)
Slack ─▶ nagi ─runWorkflow─▶ agent({cli:'cmux'}) ─▶ adapter.run(spec)
  ▲        │                                            │ cmux new-workspace --cwd <repo>
  │        │ agentbus watch nagi                        │   --command "claude --session-id … --settings … -- <prompt>"
  │        ▼ (nagi daemon loop)                         ▼
  │   agentbus (the spine)  ◀── message(progress) ── interactive claude on a surface
  │   ~/.agentbus/bus.db    ◀── ask(approval) ──────── (PreToolUse hook: `agentbus ask nagi`)
  └── render to Slack thread ─ reply ──▶ agentbus ──▶ reply ┘
                            ◀── message(result) ──────── (on completion)
                       adapter.run() resolves ◀── result message + transcript usage
```

Boundaries:
- **`cmux-claude-adapter`** — engine↔surface bridge. Knows cmux, agentbus,
  claude. Knows nothing about Slack or nagi internals.
- **agentbus** — transport only; never interprets payloads.
- **nagi** — injects the adapter; bridges agent-side agentbus traffic to Slack;
  owns run↔thread correlation.

## The agentbus contract (agent-side)

- Recipient: `nagi` (registered persistent by nagi at startup:
  `agentbus register nagi --persistent`).
- Sender (agent + its hook): unregistered `ext:awe-<runId>`. `ask` does not
  require the sender to have an inbox — the reply lands in the asks row and the
  blocked `agentbus ask` call polls it by `request_id`.
- nagi consumes via a single long-running `agentbus watch nagi` and dispatches
  by `payload.type`:
  - `progress` → post `text` to the run's Slack thread.
  - `approval` (`kind == "ask"`) → post Block Kit Approve/Deny buttons (reuse
    nagi's existing `escalation/blocks.ts`); on click,
    `agentbus reply <ask-envelope-id> nagi {behavior}`.
  - `result` → resolve the adapter's pending `run(runId)`.
- Watch lifecycle (reference-project sharp edge): exactly one `watch nagi` per
  nagi process; deduplicate on launch; reap on shutdown. `watch` never consumes
  the inbox, so a dead watcher loses notifications but not messages
  (`check-inbox` recovers them).

## The adapter (`CliAdapter` implementation)

`caps`: `{ schema: false, resume: false, tools: true }` for MVP (no structured
output capture from interactive claude yet).

`run(spec: AgentSpec): Promise<AgentResult>` steps:

```
runId      = spec.escalation?.runId ?? newId()
sessionId  = newUuid()
settings   = writeApprovalSettings({ nagiInstance: "nagi", runId, policy: spec.escalation?.policy })
prompt     = composePrompt(spec.prompt, spec.instructions, agentbusDirective(runId))
command    = claudeCommandLine({
               sessionId, settingsFile: settings.path, prompt,
               model: spec.model, addDir: spec.cwd,
             })   // claude --session-id <id> --settings <file> --append-system-prompt <dir> --add-dir <cwd> -- <prompt>
surface    = await launchSurface({ cwd: spec.cwd, command })          // cmux new-workspace --json, capture ref
result     = await awaitResult(runId)                                  // resolves on {type:"result", runId}
usage      = await readUsage(sessionId, spec.cwd) ?? { inputTokens: 0, outputTokens: 0 }
return { text: result.text, raw: { surface, result }, usage, sessionId }
```

Injectable seams (defaults call the real CLIs; tests pass fakes):
- `launchSurface({cwd, command}) -> { surfaceRef }` — default:
  `cmux new-workspace --cwd <cwd> --command "<command>" --json` (no `--focus`).
- `awaitResult(runId) -> { text }` — default: drain agentbus for the `nagi`
  recipient and match `payload.type == "result" && payload.runId == runId`. In
  nagi (Phase 2) this is wired to nagi's central watch bridge instead, so there
  is only one agentbus consumer in-process.
- `readUsage(sessionId, cwd) -> AgentUsage | null` — read the final assistant
  usage from `~/.claude/projects/<hash(cwd)>/<sessionId>.jsonl`.
- `writeApprovalSettings(...) -> { path }` — writes the Claude settings file
  containing the `PreToolUse` hook; reuses the structure of the engine's
  existing `buildEscalationSettings` as the template, retargeted at agentbus.

`agentbusDirective(runId)` (appended system prompt) instructs the agent to
`agentbus send nagi` a `{type:"progress", runId, …}` at meaningful milestones
and a single `{type:"result", runId, text}` when finished. The agent is also
expected to have the **agentbus skill** available. Progress is best-effort;
**result is required** for `run()` to resolve (backstopped by the wall-clock
ceiling below).

### Approval hook shim (shipped with the package)

A small script set as the Claude `PreToolUse` hook. Reads the hook payload from
stdin (`tool_name`, `tool_input`, `cwd`), issues:

```
agentbus ask nagi --from "ext:awe-$RUN_ID" --timeout-ms "$TIMEOUT_MS" -f <payload.json>
```

with payload `{type:"approval", runId, tool, input, cwd}`, parses the reply
`{behavior:"allow"|"deny", reason?}` (same shape the engine's `parseAskStdout`
already handles), and emits Claude's permission decision. Anything that is not
an explicit `allow` is a deny. For `onTimeout:"wait"`, the shim loops with a
bounded per-call timeout up to the 24h ceiling (the `agentbus ask` timeout
exits non-zero and preserves the `request_id` for a late `ask-result`).

### Approval transport — alternatives considered

nagi is **remote-first**: the human approves from their phone via Slack, and
the escalation round-trip is a core trust feature precisely because the claude
adapter grants unrestricted Bash. Three approaches were weighed:

- **A — our `agentbus ask` hook → Slack (chosen).** Deterministic, can't be
  skipped, and *we own the timeout* (loop up to the 24h ceiling) — the only
  option whose wait semantics fit a phone reply that may take minutes. Works
  identically headless or surfaced. Cost: must ensure cmux's own claude
  permission interception does not also fire (see risk #3).
- **B — bridge cmux's native Feed (deferred enhancement).** cmux auto-installs
  a `PermissionRequest` interception for claude and exposes it via
  `cmux events --category feed` (`feed.item.received`/`feed.item.completed`) +
  the `feed.permission.reply` socket verb, with Once/Always/All-tools/Bypass/Deny
  modes and native macOS notifications. Attractive for *dual* desk+phone
  control, but Feed is an advisory **120s soft-wait** that falls through to the
  in-TUI prompt — which a remote-only user cannot answer. Revisit once we choose
  to mirror Feed locally and handle the 120s window.
- **C — shogun-style bypass** (`--dangerously-skip-permissions`, watch/kill the
  pane). Rejected: no per-tool gate contradicts nagi's trust model, even though
  surfacing makes the agent visible and killable.

### Launch command line (cmux)

`cmux new-workspace --cwd <repo> --command "<claude line>"` types the claude
line + Enter into the new workspace's terminal surface. **Only the launch line
crosses the terminal; all agent data flows over agentbus** (the shogun lesson —
never push message content through the terminal). Capture the surface/workspace
ref from `--json` output for later inspection/close.

## nagi integration (Phase 2)

- **Startup:** `agentbus register nagi --persistent`; spawn one `agentbus watch
  nagi` under nagi's process supervision (dedup + reap on shutdown).
- **Adapter injection:** add `cmux: makeCmuxClaudeAdapter({ awaitResult:
  pendingRuns.await })` to `RunOptions.adapters` in `src/index.ts`.
- **Run↔thread correlation:** a `PendingRuns` map `runId -> { threadTs, resolve
  }`. Before `runWorkflow`, nagi creates `runId`, records `threadTs`, and the
  injected `awaitResult(runId)` returns a promise the bridge resolves on the
  `result` message. progress/approval envelopes look up `threadTs` by `runId`.
- **Bridge:** the watch loop routes by `payload.type` to: thread post
  (progress), Block Kit buttons + `agentbus reply` (approval), `PendingRuns`
  resolution (result).
- **Trigger:** a dedicated **`surface` seed workflow** in
  `src/registry/workflows/surface.ts`:
  ```
  meta:       { name: "surface", description: "Run one interactive agent on a cmux surface" }
  argsSchema: z.object({ task: z.string().min(1), repo: repoEnum(aliases) })
  default:    async (wf) => wf.agent(wf.args.task, { cli: "cmux" })
  ```
  cwd comes from the repo alias via the existing dispatcher `decide()` run-level
  cwd, exactly as other workflows. Triage routes to `surface` like any entry; no
  bespoke control command (which would fork a second path around the engine).

## Data flow (one surfaced run)

1. Slack message → nagi triage → `surface` workflow → `agent({cli:'cmux'})`.
2. Engine calls `adapter.run(spec)`; adapter launches claude on a new surface.
3. Agent works; emits `progress` messages → nagi posts them in-thread.
4. Agent hits a gated tool → `PreToolUse` hook `agentbus ask nagi` (blocks) →
   nagi posts Approve/Deny → click → `agentbus reply` → hook returns decision.
5. Agent finishes → `agentbus send nagi {type:"result",runId,text}`.
6. Bridge resolves `run()`; adapter reads transcript usage, returns
   `AgentResult`; engine completes the workflow; nagi posts the result; the
   surface stays open.

## Error handling

- **No result / surface dies:** `run()` enforces a wall-clock ceiling; on expiry
  it returns/throws a failed result → nagi posts the error in-thread (never
  silent). `agentbus sweep` reclaims strays.
- **Approval timeout:** honor policy — `wait` loops to the 24h ceiling; otherwise
  deny. Unparseable reply → deny.
- **cmux/agentbus CLI failure at launch:** `run()` throws immediately with stderr
  context.
- **Transcript unreadable:** usage falls back to zeros; the run still completes.
- **Watcher death:** notifications missed but messages durable; recover via
  `check-inbox` on watcher restart.

## Testing

- **Adapter unit tests** with injected seams: assert the exact cmux command line,
  the settings/hook file contents, the approval shim's allow/deny mapping
  (including timeout→policy), and usage parsing from a fixture transcript JSONL.
  No live cmux/agentbus.
- **nagi bridge tests:** feed synthetic `progress`/`approval`/`result` envelopes
  → assert thread posts, Block Kit wiring + `reply`, and `PendingRuns`
  resolution.
- **Phase 1 real smoke** (real cmux + agentbus on this machine): a standalone
  script in the adapter repo runs one surfaced agent end to end — launch on a
  surface, one tool approval round-trip, progress visible, result captured.

## Phasing

- **Phase 1 — adapter alone, real smoke.** Build the adapter + approval shim;
  prove launch (cmux socket), approval hook→`ask`, progress, and result+usage
  against real cmux + agentbus via a local script. No nagi changes. This is
  literally "just start an agent on a new surface" and de-risks the novel
  mechanics in isolation.
- **Phase 2 — nagi integration.** Register `nagi`, host the watch bridge, inject
  the adapter, add the `surface` workflow.

## Open questions / risks to resolve during implementation

1. **Daemon not inside cmux.** `new-workspace` defaults its window to the
   caller's `$CMUX_WORKSPACE_ID/$CMUX_SURFACE_ID`. A launchd daemon has none.
   Phase 1 runs the smoke from inside a cmux terminal (context present);
   Phase 2 must resolve window targeting (`--window`, or create one via
   `new-window`) and how nagi obtains `CMUX_SOCKET_PATH` + password.
2. **Prompt quoting via `--command`.** The launch line is typed into a shell, so
   the prompt must be safely quoted/escaped. Confirm a robust encoding (and
   consider passing the prompt via a temp file the claude line reads, to avoid
   shell-escaping the whole task).
3. **Exact Claude hook/settings shape, and cmux-wrapper reconciliation
   (Phase-1 task).** Confirm the `--settings` `PreToolUse` hook payload fields
   and the permission-decision output format for the installed claude version
   (template: engine `buildEscalationSettings`). **Critically:** cmux's claude
   integration is "wrapper-injected" and auto-intercepts `PermissionRequest`
   into its Feed. Determine whether that fires for an agent we launch via
   `new-workspace --command "claude …"`; if it does, it would double-handle
   approvals against our hook. Resolution: run plain `claude` with cmux's claude
   integration disabled for these surfaces so our `agentbus ask` hook is the
   sole approval authority. Verify empirically in the Phase-1 smoke.
4. **Transcript path hashing.** Confirm the `~/.claude/projects/<hash>/` naming
   for the target cwd, and that interactive sessions with `--session-id` write
   there with usage.
5. **agentbus skill availability** in the launched claude (so it reliably emits
   progress/result), vs. relying solely on the appended-system-prompt directive.
6. **Concurrency.** nagi is single-flight today; surfaced runs inherit that.
   Multiple concurrent surfaces (and per-run watch correlation at scale) are
   deferred.

## Success criteria

- A Slack request routed to `surface` opens a cmux surface running interactive
  `claude` (no `-p`), and its progress, one tool-approval round-trip, and final
  result all arrive in the originating Slack thread over agentbus.
- The adapter returns a valid `AgentResult` (text + transcript usage) without the
  agent process exiting; the surface remains open afterward.
- Adapter unit tests pass with no live cmux/agentbus; the Phase 1 smoke passes
  against real cmux + agentbus.
- nagi's human Slack ingress and existing headless workflows are unchanged.
