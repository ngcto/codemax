---
name: principle-redesign-from-first-principles
description: "Apply when integrating a new requirement into an existing design. Redesign as if the requirement had been a foundational assumption from day one, instead of bolting it on."
disable-model-invocation: true
---

## Pi execution contract

Use codemode scripts and the unprefixed codemax tools. Read the package execution binding at `../../PI_BINDING.md` when a host-specific operation is unclear. Bundled instructions are read-only. Use `capability` for executable extensions and `learn` for separate evidence-backed skills; never edit this pack. Role/model defaults come from `settings`, only detected model ids, with parent inheritance otherwise. No prose instruction grants external-write, install, credential, billing, or desktop-takeover permission.

# Redesign From First Principles

When integrating a change, don't bolt it onto the existing design. Redesign as if the requirement had been there from the start.

- Read all affected files and understand the current design
- Ask: "if we were writing this from scratch with this new requirement, what would we build?"
- Propagate the change through every reference: types, docs, examples, rationale sections
- Think about the whole redesign, then deliver it incrementally

This is the method for preserving option value when integrating changes into an existing design.
