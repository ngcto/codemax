---
name: setup-benny
description: Configure Benny's Pi issue-triage and reproduce/fix rounds, then explicitly connect a scheduler or webhook host.
disable-model-invocation: true
---

# Set up Benny

Benny is a dormant procedure pack, not an installed scheduler or a Slack integration. Follow codemax's Pi execution binding. Bundled sources are immutable. User-owned configuration and host code live outside the pack. No instruction grants permission to install software, write to Slack or a tracker, open a PR, or enable normal traffic.

## 1. Scaffold without overwriting

Ask which trusted repository owns the automation. In that repository call `automation({action:"scaffold"})`. It copies the full pack to `.pi/automations/benny/`, preserves destination-only files, and reports conflicts without replacing local edits. Review each conflict with the user.

If a separately deployed host needs project-scoped codemax, install it explicitly using `pi install <reviewed-package-source> --local`. Preserve unrelated `.pi/settings.json` entries. Pi uses `packages` settings, not an editor-specific plugins/enabled object. Verify the package in a fresh Pi process rooted in the target repository. Do not silently install or change trust.

Confirm that the copied pack contains FOR_AGENTS.md, both operational skills, their references, and the templates. Skills under this pack are direct instructions, not slash skills. Use `workflow({action:"read",kind:"automation",name:"triage-issue-reports"})` for bundled access.

## 2. Keep configuration separate

Read `../../templates/configuration.example.yaml` and `../reproduce-and-fix-issues/references/feature-map.example.md`. Create secret-free user-owned files under `.pi/benny/`, not inside the source-managed pack. Examples are configuration.yaml, feature-map.md, and routing.md.

Confirm every required field before a dry run:

- Source Slack channel ID, immutable root thread timestamp, and trusted triage identity.
- Repository URL and exact default branch or test baseline.
- Issue tracker adapter, team, project, labels, intake state, and compensation capability.
- Optional operations channel and routing map. Owner pings remain off by default.
- Control skill, complete user-facing feature map, safe test environment, and artifact retention.
- Explicit available provider/model IDs from `settings({action:"models"})`, with reasoning and runtime budgets.
- Exact configured read/write tool names discovered through codemode, and the user's operation-specific grants.

Fail closed on placeholders, missing coordinates, unclear ownership, or unavailable integrations. Secrets stay in the deployed host's secret store. Never paste token values into a prompt, package file, or committed YAML. Workers must not receive Slack credentials.

## 3. Validate the adapters

Read `../reproduce-and-fix-issues/references/control-adapter.md`. Prove the control skill can launch the real app, reach every mapped user flow, exercise states without forcing outcomes, inspect readback, capture requested screenshots/video, and clean up its own resources.

Use browser-use or cua-driver only after readiness checks. If missing or unconfigured, request approval before consulting setup guidance or helping install/configure. Do not silently restart shared services or take over the desktop. Leave reproduction disabled until the adapter passes.

Discover configured Slack and tracker integrations with searchTools and describeTool. Confirm thread replies, attachment reads, dedupe queries, scoped updates, and compensating actions. Do not invent undocumented endpoints. A draft PR action needs an explicit grant; merge and deployment stay forbidden.

## 4. Run bounded proposals first

Call `automation({action:"run",phase:"triage",report:<exact-report>,configuration:".pi/benny/configuration.yaml"})` for one exact report. The result is a proposed source-thread verdict and tracker action, not a sent message or created ticket.

After the parent verifies a trusted triage marker, use phase reproduce for one isolated clean-worktree attempt. It may return evidence and local commits. The parent inspects and reruns proof before proposing a draft PR. The bundled runner never posts, merges, deploys, or enables a scheduler.

Use stable same-repository paths for deployed files. Commit secret-free operational files only with user approval. A fresh host checkout must contain the exact reviewed pack, configuration, and feature map; never depend on a local package-cache path.

## 5. Integrate a host explicitly

Pi core does not provide an Automations editor or a built-in automate skill. Choose an existing scheduler/webhook host, or implement a project-owned adapter after approval. The host owns trigger validation, immutable channel/thread coordinates, dedupe state, secrets, cancellation, spend limits, and all external writes.

Configure two bounded phases. Triage handles a new top-level report and proposes one thread verdict. Reproduction accepts only a trusted configured marker for the same original thread. It checks ownership and existing fixes before attempting any change. Each final external operation is executed by the parent/host under the exact user grant, never by a delegate.

Prepare and review one integration at a time. Changing an existing host configuration must not create replacement schedules or duplicate triggers. Start disabled. No hidden scheduling, credential setup, installation, PR posting, or traffic enablement.

## 6. Test thread safety before enabling

Use a harmless fixture or a dedicated test channel. Verify all seven predicates:

1. Triage stores the original channel and root thread timestamp and proposes exactly one reply.
2. Its verdict has exactly one configured marker.
3. Reproduction accepts the marker only from the configured triage identity.
4. Both phases retain the same immutable source coordinates.
5. No source-channel root post occurs.
6. Workers cannot call Slack write tools or receive chat secrets.
7. Missing coordinates, deleted parents, duplicate reports, failed preflights, and timeouts produce no unintended external writes.

Also test cancellation, retry idempotence, and recovery from a partially applied tracker update. Review the dry-run evidence and get explicit approval before enabling normal traffic. Report untested integrations as unverified, not ready.
