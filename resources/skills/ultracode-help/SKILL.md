---
name: ultracode-help
description: Help users choose a codemax skill, playbook, executable capability, provider, or setup action in Pi. Use /skill:ultracode-help with a question.
disable-model-invocation: true
---

## Pi execution contract

Use codemode scripts and the unprefixed codemax tools. Read the package execution binding at `../../PI_BINDING.md` when a host-specific operation is unclear. Bundled instructions are read-only. Use `capability` for executable extensions and `learn` for separate evidence-backed skills; never edit this pack. Role/model defaults come from `settings`, only detected model ids, with parent inheritance otherwise. No prose instruction grants external-write, install, credential, billing, or desktop-takeover permission.

# codemax help

Answer the question, do not launch work when the user only asked for help. Link actual local bundled files. Do not invent public repository URLs.

codemax is a Pi extension built for codemode-only agents. Loading it activates the fixed only-mode executor and plain default voice. Nontrivial work follows ultracode; trivial turns stay lightweight. No separate voice skill or Cursor Custom Mode is needed.

- Install this local package with `pi install /path/to/codemax`, or try `pi -e /path/to/codemax/src/index.ts`. Run `/reload` after installation in an existing session.
- Run `/skill:setup-codemax` to choose verified model roles, reasoning budget, web providers, and concurrency. Omitted roles inherit the parent model.
- Run `/skill:ultracode <goal and falsifiable success check>`, or ask naturally. The persistent execution policy already applies every turn.
- Call `tools.workflow({action:"list"})` for the complete skill, playbook, and automation inventory. Read a resource with `action:"read"`; start the appropriate playbook with `action:"start"` and a task.
- `how` explains behavior. `why` investigates reasons and history. `teach` combines them. `architect` explores interfaces and data shapes before code. `arena` compares candidates, `swarm` splits coverage, `interrogate` runs adversarial review.
- `tools.panel` runs independent candidates/reviewers and optionally a cross-model judge. Writable workers need clean isolated worktrees. The parent verifies and grafts explicitly.
- `tools.verify` captures command evidence, including a failing-first repro. A green build is not proof of a real UI/CLI outcome.
- `tools.script({action:"list"})` lists durable orchestration, PR monitor, plan validator, worktree audit, and decision-log scripts.
- `tools.control` preflights/drives browser-use and cua-driver. Missing readiness requires approved on-demand setup. Native GUI authorization never follows from a failed CDP attempt.
- `tools.search` and `tools.fetch` wrap hosted Exa, Firecrawl, and Parallel, trying anonymous access without credentials. Firecrawl may require account-backed access; keep provider errors visible. `tools.web` discovers extended remote tools. `/login <provider>` uses Pi's credential store and OAuth. GPT native web search replaces script search and keeps fetch; Grok adds native web/X tools. Other families retain provider search/fetch only.
- `tools.capability` saves composable JavaScript as session, project, or global executable tools. No prefix. Tool-table snapshots refresh on the next codemode call; `capability(action=run)` executes immediately in the saving script.
- `tools.learn` saves evidence-backed reusable skills outside the bundle; `tools.recall` retrieves them immediately. `tools.history` supports explicitly scoped recent-session mining.
- `tools.automation` scaffolds and runs bounded Benny triage/repro rounds. No scheduler, merge, deployment, or external posting is enabled implicitly.

Bundled instructions are read-only. Broken guidance becomes a separate learned overlay or executable capability fix, not a bundled skill edit. Own the final verdict, and show blockers rather than claiming success.

For budget concerns, use fewer panel seats, lower concurrency, a smaller reasoning budget, or cheaper detected models. These do not waive proof or safety gates.
