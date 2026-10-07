# Set up codemax

In this page you install the extension, pick which models codemax uses, and run your first task. Setup is one command plus a short conversation.

## Install the extension

In a terminal, run:

```text
pi install git:github.com/ngcto/codemax
```

Restart Pi or run `/reload`. For a one-session development load, run `pi -e /path/to/codemax/src/index.ts`.

## Pick your models

Run:

```text
/skill:setup-codemax
```

[`/skill:setup-codemax`](../../skills/setup-codemax/SKILL.md) detects the models you have access to, asks for a reasoning budget, shows you each role (code delegates, judgment, the review panels), and asks what you want. Answer the questions and choose the scope. Global settings use `~/.pi/agent/codemax/config.json`, project settings use `.pi/codemax/config.json`, and session settings follow the active branch.

The default budget is `medium`, requesting `high` reasoning. `small` requests `medium`, `large` requests `xhigh`, and `unlimited` requests `max`. Pi clamps each request to the selected model's verified capabilities. A role without a configured model inherits the parent; no private or guessed model slug is used.

You only override what you care about. A role with no line in the rule keeps the skill's default. To restore parent inheritance, save that role as `inherit-parent`. Setup changes only the choices you ask it to save; it does not reset unrelated settings.

You might be wondering what happens if you use Auto. Set a role to `inherit-parent` or `auto` and codemax selects the parent's detected provider/model pair for the fresh worker. Both values mean the same thing, and neither is a model slug. For a panel role the value is a list. Explicit task briefs rotate through those choices; the tasks array controls the panel size. Setup also configures `swarm workers`, the default model for every `/swarm` worker unless a race names a model for each arm.

## Accept the verification offer, or don't

At the end of setup, `/skill:setup-codemax` looks for a way to prove app behavior in your project, either a `verify-*` skill or an existing harness. If it finds neither, it offers once to generate one with [`/create-verification-skill`](../../skills/create-verification-skill/SKILL.md).

Say yes and it writes `.pi/skills/verify-<app>/`, a project-local skill that teaches agents to drive your app the way a user does. It proves the skill works once before handing it over. Say no and setup moves on. You can run `/create-verification-skill` yourself any time. [Verify and ship](./06-verify-and-ship.md#create-a-project-verification-skill) covers it in depth.

If you're new to codemax, say yes. An agent that can check its own work keeps going until the check passes. An agent that can't hands every result back to you to check by hand. Of everything in this guide, the verification skill pays off the most.

Settings refresh this session's web exposure immediately. Global/project choices are read on subsequent turns and apply to future sessions too.

## Keep the cost in check

codemax spends extra tokens on subagents and review panels. That's the price of the rigor. To spend fewer:

- Rerun `/skill:setup-codemax` and pick a smaller reasoning budget or cheaper models. A strong model in the main chat with cheaper, faster models in the code roles is a good split.
- Set a role to `auto` or `inherit-parent` so it runs on the chat's own model.
- Shorten a panel list. Each entry runs one subagent.
- Save `/skill:ultracode` for work that needs rigor. A small, obvious edit doesn't.

## Run your first task

Pick something real but small, and describe it the way you'd describe it to a colleague:

```text
/skill:ultracode add a --json flag to this command. text output stays byte-identical. verify both.
```

Watch the todo list. Its first items are the matched playbook's steps copied in, the Feature playbook for this prompt. If `/skill:ultracode` skips a step, the step stays in the list with `skip: <reason>`, so you can see what it chose not to do.

From here, type normal follow-ups. The extension injects its concise voice and nontrivial-work posture on every turn. No custom editor mode is needed. The workflow checkpoint follows the active Pi session branch.

Next: [Route work through `/skill:ultracode`](./02-ultracode.md).
