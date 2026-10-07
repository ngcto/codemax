# Pi execution binding

codemax's bundled resources are immutable task procedures. Use the implementation contracts here in place of platform-specific APIs.

| Procedure | Executable Pi capability |
| --- | --- |
| Task, workers, named agents | `delegate` or `panel`; fresh Pi JSON-mode process, isolated context, clean writable worktree; explicit agent profile |
| Todo list, plan checkpoint, phase | `workflow`; original steps, evidence, skips, decisions, pause/resume |
| AskQuestion | `ask`; UI question/approval, never automatic consent |
| Agent transcripts | `history`; scoped Pi JSONL sessions/active branch |
| Per-role model rule | `settings`; verified models, session/project/global JSON configuration |
| Browser / Electron / web UI | `control-ui` chooses browser-use for page/CDP tasks or cua-driver for native controls and GUI-only work |
| Native desktop/window | `control-ui` selects cua-driver; observe exact target, act once, verify |
| CLI/TUI proof | `control-cli` chooses shell `verify` for command evidence or `control-ui` for visible terminal interaction |
| Code cleanup / prose cleanup | `deslop` for a scoped code diff; `unslop` for writing |
| create-skill / reflect / personal mode | `learn` outside the bundle, evidence required, no bundled edits |
| More tools or helper scripts | `capability`, `web(action=tools/call)`, editable executable scripts |
| PR/stack observation | Ported watch-pr; `gh` default, optional tools discovered first |
| Multi-day orchestration | Ported orch plain-file store with locking, verdict ledger, gates, inbox pointers |
| Issue automations | Benny procedures via `automation`; explicit scheduler/host integration, no hidden posting |

Use actual Pi schemas, not historical parameter names. `readOnly` replaces readonly, `agent` replaces subagent_type, and `isolate:true` is required for writers. `allowDelegation:true` is an explicit bounded nested-spawn grant; it is off by default. Pi automatically exposes skills as `/skill:<name>`; arguments after the command become the user request. codemax registers no dedicated slash commands; use Pi's native skill commands and the composable tools. Imported short slash names are workflow labels, not extra extension commands.

Resolve bundled skills and playbooks through `workflow(action=read)` and executable paths through `script(action=list/run)`. Installed resources are not assumed to live in the active repository or on its trunk. Read project-owned docs from their recorded repo paths. Bundled workers return local commits and proposals; the authorized lead owns publishing and integration.

No cloud provisioning, resume-agent API, Automations editor, or persistent wake scheduler is bundled. Fresh workers receive consolidated scope. A panel receives candidate/reviewer briefs; it does not recursively run its whole parent skill in every seat. Remote and scheduled execution need a separately configured host.

Every model-issued tool call passes through codemode. Nested operations go through Pi's tool hooks. Await independent operations with Promise.allSettled; sequence dependent operations. Tool-table changes appear next script. A saved capability can run in the current script through capability(action=run).

The browser-use and cua-driver skills use `disable-model-invocation: true`; `control-ui` reads only the selected driver on demand. Setup of external control software is never automatic. Check readiness, ask approval, then read the current setup guidance. Installation, permissions, foreground control, external writes, deployments, secrets, and irreversible changes retain their own authorization gates.

Readonly delegates are a best-effort tool policy, not an OS sandbox. Packages and host tools run with the account's permissions. Use containers/VMs and narrowly scoped credentials for untrusted code. Keyless provider limits and OAuth availability depend on the provider deployment; errors must remain visible.
