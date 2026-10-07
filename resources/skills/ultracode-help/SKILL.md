---
name: ultracode-help
description: Help choose a codemax skill, playbook, tool, provider, or setup action. Use /skill:ultracode-help with a question.
disable-model-invocation: true
---

# codemax help

Answer the question. Link the relevant bundled file and give the next command. Start work only when requested.

- Install with `pi install git:github.com/ngcto/codemax`, then `/reload`.
- `/skill:setup-codemax` selects model roles, budget, providers, and concurrency.
- `/skill:ultracode <goal and success check>` starts a workflow.
- `workflow(action="list")` lists skills and playbooks; `action="read"` loads one.
- `how`, `why`, and `teach` explain code. `architect`, `arena`, `swarm`, and `interrogate` support design and review.
- [deslop](../deslop/SKILL.md) cleans code; [unslop](../unslop/SKILL.md) cleans prose.
- [control-ui](../control-ui/SKILL.md) selects browser-use or cua-driver. [control-cli](../control-cli/SKILL.md) uses repo-native harnesses, tmux, and PTY probes.
- `verify` records repro and test evidence. `script(action="list")` lists PR-watching, orchestration, and audit scripts.
- `search` and `fetch` use Exa, Firecrawl, or Parallel. `/login <provider>` enables account-backed access. Native GPT/Grok search depends on the selected route.
- `capability` saves JavaScript tools. `learn` saves evidence-backed skills; `recall` and `history` retrieve prior work.
- `automation` runs bounded Benny triage/repro rounds.

For lower cost, use fewer review seats, lower concurrency, smaller budgets, or cheaper available models.
