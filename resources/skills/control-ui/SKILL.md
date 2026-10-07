---
name: control-ui
description: Choose browser-use or cua-driver for a specific UI task. Use for web or native app interaction, Electron, terminal windows, screenshots, GUI-only requests, or UI verification.
---

# Choose the UI tool

Pick by the outcome and the permitted interaction method.

## Choose by use case

| Use case | Prefer | Why |
| --- | --- | --- |
| Public information | `fetch` or `search` | A readable public page needs no browser or desktop control. |
| Web page interaction | [browser-use](../browser-use/SKILL.md) | CDP reaches page content, logged-in tabs, rendered state, DOM, and network evidence. |
| Browser-hosted terminal | [browser-use](../browser-use/SKILL.md) | The terminal lives inside a web page. Use page input and fresh rendering evidence. |
| Browser chrome or OS dialogs | [cua-driver](../cua-driver/SKILL.md) | Browser toolbars, native menus, file pickers, and permission prompts are outside page content. |
| Electron renderer | [browser-use](../browser-use/SKILL.md) | Prefer CDP for page behavior when an approved endpoint already exists. Otherwise choose authorized native control or report the blocker; do not silently enable debugging. |
| Electron menus or dialogs | [cua-driver](../cua-driver/SKILL.md) | Native menus, file pickers, window controls, and OS prompts are outside the page. |
| Native app | [cua-driver](../cua-driver/SKILL.md) | Operate an exact application window through its accessibility tree, menus, or fresh pixels. |
| GUI-only | [cua-driver](../cua-driver/SKILL.md) | Honor the requested method. Do not replace UI input with DOM/CDP, APIs, clipboard calls, or shell writes. |
| Visual layout or canvas | The driver that owns the target | Use a fresh screenshot. Missing semantic controls alone does not require desktop takeover. |
| CLI/TUI test | [control-cli](../control-cli/SKILL.md) | Use repo-native harnesses, tmux, or PTY probes when terminal harness input is permitted. |

For CLI/TUI tests, follow control-cli directly. Split mixed UI tasks into page checks and native-window checks.

## Load and preflight only the selected driver

Read the selected skill with `tools.workflow({action:"read",kind:"skill",name:driver})` or its linked file.

Call `tools.control({driver,action:"status"})` before driving. If not ready, call `tools.control({driver,action:"setup"})` to request approval before reading setup guidance. `approval_required` or `declined` means stop. Setup approval does not authorize installation, upgrades, login, permission changes, paid browsers, or foreground takeover.

A blocked or failed route is not permission to switch drivers or interaction methods. Reobserve, explain the limit, and ask before using a route outside the existing grant.

## Act and prove

- State the selected driver, exact page/window, and expected result.
- Observe fresh state, act once, then verify the user-visible postcondition. Use current handles or tokens; never guess a tab index, target, or pixel.
- Use `control(action="run")` with a browser-use Python script or an advertised cua-driver command and arguments. Discover unfamiliar schemas; do not invent helpers.
- Keep one controller for a shared browser/desktop. Worktrees do not isolate focus, tabs, credentials, or OS state.
- Record only when requested. Preserve exact artifact paths; review private content before sharing. End your run without stopping a shared daemon or closing the user's app.

Exit zero proves command completion, not the UI result. Report the observed state and any unverified behavior.
