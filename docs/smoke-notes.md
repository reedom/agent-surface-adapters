# Phase 1 smoke notes

Run: `pnpm smoke "<task>" "$PWD"` with the cmux app running (CMUX_SOCKET_PATH reachable), and `agentbus` + `claude` on PATH. Record findings against the spec's open risks below.

## Result: PASS (2026-06-13)

Task: "Run `pwd` with the Bash tool, then send the directory as your result."
agentbus: v0.3.0 (debug binary symlinked into ~/.cargo/bin). claude: Claude Code v2.1.177 (Opus 4.8). cmux launched `workspace:11`.

- [x] Surface opens with interactive claude (no -p) running the task — confirmed (interactive TUI, "Worked for 11s", surface stayed open)
- [x] Approval round-trip: `[approval] ... -> allow` for the `pwd` Bash call (gated via our `agentbus ask` hook → consumer → allow → claude proceeded)
- [ ] Progress: no `[progress]` lines — claude sent only the final result (progress is best-effort; not emitted for this simple task)
- [x] Result captured: `[result] runId=... text=/Users/.../cmux-claude-adapter` then `[smoke] adapter returned:` with text + usage `{input:2, output:200}`
- [x] Surface stays open after result

## Risk findings

- **Risk #1 (daemon/window targeting outside cmux):** Launch worked when run from a cmux-aware shell; `cmux new-workspace` returned `OK workspace:11`. The launchd/daemon-not-inside-cmux case is still unvalidated — defer to Phase 2 (may need `--window`/`new-window` and explicit `CMUX_SOCKET_PATH`).
- **Risk #3 (cmux wrapper double-intercept):** Not observed. Approvals flowed through OUR `PreToolUse` hook (the `[approval]` lines prove the hook fired and gated execution); no cmux Feed prompt appeared and claude proceeded only after our allow. Our hook is the sole approver in this setup. (Still worth confirming cmux's Claude integration setting in Phase 2 to guarantee no double-handling across cmux versions.)
- **Risk #4 (transcript / usage):** Resolved. `readUsage` located the transcript via `--session-id` and returned non-zero usage `{input:2, output:200}`.
- **Risk #5 (directive vs agentbus skill):** Resolved. Claude reported the result purely from the appended-system-prompt directive (`printf '{...}' | agentbus send nagi --from ext:awe-<runId>`); the agentbus *skill* was not required.

## New finding for Phase 2 — reporting trips the approval hook

Claude reports to agentbus by running `agentbus send` **as a Bash command**, so each report triggers our `PreToolUse` approval hook (the smoke showed a 2nd `[approval]` for the result-send). In the smoke this is invisible (auto-allow), but in production every progress/result send would escalate to the human on Slack.

**Phase 2 mitigation:** pre-authorize the agent's own `agentbus` calls so reporting never escalates — e.g. a settings permission allow-rule / `--allowedTools` entry for the `agentbus send <nagi>` Bash command (and `agentbus reply`), or route reporting through a non-Bash channel. Only genuine task tools should reach the human approval path.

## Minor note

`cmux new-workspace --json` returned ref text (`OK workspace:11`), not JSON, so `SurfaceRef.ref` was undefined and only `raw` was captured. Harmless (we tolerate non-JSON), but if a structured surface id is needed later, confirm the correct cmux flag/output.
