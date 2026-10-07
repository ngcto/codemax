---
name: recall
description: Reconstruct recent work and reusable learnings from the active Pi branch, scoped project session history, live Git state, and available shared records. Use catch-me-up, recall, or resumption requests.
disable-model-invocation: true
---

# Recall

Start with `tools.recall({query,includeInstructions:true})` for verified recipes and the active workflow capsule. Do not mine transcripts unnecessarily when the user already supplied a complete state capsule.

For recent-work questions, pin a real time window (default seven days), topic, and active project. Use `tools.history({action:"list",days})` before `action:"search"`. Only this project's session directory is in scope. Do not read unrelated project sessions or private images/thinking. Include tool text only when the question hinges on what actually ran.

Use fresh delegates for large independent slices, passing exact transcript paths. Preserve real entry/session ids. Treat prior decisions as leads, not current facts. Check surfaced PRs, branches, and tickets against live `git`/`gh` and available read-only integrations. When a named feature has shared history, use the why workflow in parallel; unavailable sources and null results are findings, not inventions.

Reply with at most five capsule bullets, one concrete status per thread, recurring problems, and the single useful next move. Tag merged, open PR, in-flight branch, verified uncommitted, reverted, or not started. Cite actual artifacts. Tight scope beats a broad history dump.
