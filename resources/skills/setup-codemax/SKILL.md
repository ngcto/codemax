---
name: setup-codemax
description: Configure codemax model roles, reasoning budget, web providers, and delegate concurrency from models available in this Pi session. Use /skill:setup-codemax or requests to change codemax settings.
---

# Configure codemax

Use codemode scripts. Do not modify bundled skills or instructions.

1. Call `tools.settings({action:"models"})` and `tools.settings({action:"read"})`. Use only detected provider/id pairs. `inherit-parent` and `auto` use the selected parent model.
2. Ask for a reasoning budget with `tools.ask`. Small maps to medium reasoning, medium to high, large to xhigh, unlimited to max. Pi clamps unsupported levels. Do not invent model slugs containing an effort suffix.
3. Show the model choices before saving. Roles include `feature, refactoring`, `bug-fix`, `perf-issue`, `hillclimb`, `hardest tasks`, `judgment and prose`, `how explorer`, `how explainer`, `why investigators`, `why synthesizer`, `reflect tooling`, `reflect judgment, divergent, synthesizer`, `arena runners`, `arena cross-judge pool`, `swarm workers`, `architect runners`, and `interrogate reviewers`. Panel roles accept a list; explicit task briefs rotate through these choices. The tasks array, not the role list, controls panel size. Omitted roles inherit the parent. Recommend diverse available families for independent judgment, not unverified fixed defaults.
4. Select session, trusted project, or global scope. Call `tools.settings({action:"save",scope,config})`. Global writes `~/.pi/agent/codemax/config.json`; project writes `.pi/codemax/config.json`. Session settings do not affect other sessions. Project trust is required for project settings. Global and project changes apply on the next turn.
5. Web clients try anonymous Exa, Firecrawl, and Parallel endpoints without credentials. Exa and Parallel probes succeeded; Firecrawl rejected anonymous operations in this environment. Provider availability and quotas are not guaranteed. Call `tools.web({action:"status"})`. Offer `/login exa`, `/login firecrawl`, or `/login parallel` if account-backed limits are needed; never ask for credentials in chat. Native tools require GPT on an OpenAI Responses route or Grok on xAI Responses. GPT native web search replaces the script search tool while keeping fetch. Grok adds web/X tools. Setting `web.nativeInConversation=false` keeps all search inside scripts.
6. If the project lacks a reproducible real-surface harness, offer to create a project-local verification learning via `learn`. Capture actual proof first. Do not write a claim of success without evidence.
