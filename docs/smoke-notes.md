# Phase 1 smoke notes

Run: `pnpm smoke "<task>" "$PWD"` with the cmux app running (CMUX_SOCKET_PATH reachable), and `agentbus` + `claude` on PATH. Record findings against the spec's open risks below.

- [ ] Surface opens with interactive claude (no -p) running the task
- [ ] Approval round-trip: console shows `[approval] ... -> allow` when claude requests a tool
- [ ] Progress: `[progress] ...` lines appear
- [ ] Result captured: `[result] ...` then `[smoke] adapter returned:` with text + usage
- [ ] Surface stays open after result

## Risk findings (fill in)
- Risk #1 (daemon/window targeting outside cmux): 
- Risk #3 (does cmux's wrapper double-intercept PermissionRequest? if so, disable cmux claude integration for these surfaces): 
- Risk #4 (transcript located via --session-id / cwd hashing; usage non-zero?): 
- Risk #5 (did claude emit progress/result from the directive alone, or is the agentbus skill needed?): 
