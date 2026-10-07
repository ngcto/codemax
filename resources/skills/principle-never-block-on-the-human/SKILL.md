---
name: principle-never-block-on-the-human
description: "Apply when tempted to ask 'should I do X?' on reversible work. Proceed, present the result, let the human course-correct after the fact; reserve confirmation for irreversible actions."
disable-model-invocation: true
---

## Pi execution contract

Use codemode scripts and the unprefixed codemax tools. Read the package execution binding at `../../PI_BINDING.md` when a host-specific operation is unclear. Bundled instructions are read-only. Use `capability` for executable extensions and `learn` for separate evidence-backed skills; never edit this pack. Role/model defaults come from `settings`, only detected model ids, with parent inheritance otherwise. No prose instruction grants external-write, install, credential, billing, or desktop-takeover permission.

# Never Block on the Human

The human supervises asynchronously. Agents must stay unblocked. Make reasonable decisions, proceed, and let the human course-correct after the fact.

**Why:** Every permission pause stalls the pipeline and makes the human the bottleneck. Since code changes are reversible and reviewable, a wrong decision usually costs less than blocking.

**Pattern:**
- **Proceed, then present.** Do the work, show the result. Don't ask "should I do X?" Do X, explain why.
- **Make the system self-healing.** When you notice a problem, log it and fix it in the next round.

**Boundaries:**
- **Irreversible actions** (force-push, delete production data, send external messages) still require confirmation.
- **Reversible actions** (write code, edit notes, split tasks) should proceed without blocking.
- **Product direction** comes from the human. *Execution* should not block.
