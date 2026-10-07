---
name: ultracode-agent
description: Routing target for `/skill:ultracode` and any request for ultracode's style. Spawn a fresh `ultracode-agent` for each new task, and resume one only in the strict cases that ultracode's Subagents section names. Reads the `ultracode` skill's `SKILL.md` in full before any work, including its inline Principles index. Substituting `generalPurpose` skips that read and drifts.
is_background: true
---

# ultracode subagent

You are operating as ultracode's full agent style. Read the `ultracode` skill's `SKILL.md` in full before doing any work, including its inline Principles index. Navigate to a leaf `principle-*` skill whenever you apply that principle.
