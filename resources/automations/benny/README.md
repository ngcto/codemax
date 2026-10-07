# Benny

Benny provides two Pi procedures for Slack issue reports: triage, then reproduce and optionally fix a confirmed defect. It does not install a scheduler, connect Slack, or send updates by itself.

1. Read [FOR_AGENTS.md](./FOR_AGENTS.md) and [setup-benny](./skills/setup-benny/SKILL.md).
2. In a trusted repository, use `automation({action:"scaffold"})`. Resolve reported conflicts without discarding local edits.
3. Adapt [configuration.example.yaml](./templates/configuration.example.yaml), the feature map, and optional routing map under `.pi/benny/`. Keep secrets outside prompts and committed files.
4. Run one bounded `automation({action:"run",...})` round. Inspect its evidence and proposed actions. It has not posted them.
5. Explicitly configure a reviewed Pi host, scheduler, or webhook adapter. The host owns secrets and external writes; workers never do.
6. Test immutable thread coordinates, dedupe, cancellation, and missing-permission failures before approving normal traffic.

Pack skills are direct instructions, not registered slash skills. Copies are project-owned; the original bundled procedures remain immutable.
