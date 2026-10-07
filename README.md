# codemax

A Pi extension that turns rigorous engineering workflows into composable codemode tools. It ports the upstream playbooks, review panels, principles, and Benny procedures to Pi instead of pretending editor-only APIs exist.

**Only mode is fixed.** The model sees one tool, `codemode`. Scripts reach ordinary Pi tools, configured MCP tools, and the unprefixed tools below. Nested calls retain Pi's validation and permission hooks.

## Install

Requires Node 22.19+ and a Pi version with `createCodemodeExtension` and `ctx.executeTool`. Development is tested against `@earendil-works/pi-coding-agent@1.0.4`.

```sh
cd /path/to/codemax
npm ci
pi install /path/to/codemax
```

Use `--local` for a trusted project install. Restart Pi or run `/reload`. Try without saving installation settings with `pi -e /path/to/codemax/src/index.ts`.

Keep Pi's built-in codemode enabled: codemax reuses it without registering a second executor or rewriting your settings. When the built-in is disabled or absent (for example in SDK sessions or delegates), codemax supplies Pi's maintained executor after startup. Its fixed only-mode policy uses the `workflow` loadout hook. Do not load another custom codemode executor.

Host tools keep their active/excluded state; only their model-facing declarations are hidden. Unrelated model-only tools stay non-callable from scripts. If you restrict tools with `--tools` while using the built-in executor, include both `codemode` and `workflow`; do not exclude either.

## Start

```text
/skill:setup-codemax
/skill:ultracode fix the duplicate retry record. repro first, then verify both cases.
/skill:ultracode-help which workflow fits this task?
```

The upstream plain-human voice is the default on every turn, not a `bro` skill. Nontrivial work uses ultracode; trivial questions stay lightweight. Pi automatically exposes bundled skills as `/skill:<name>`; trailing arguments become the request. codemax registers no dedicated slash commands; use Pi's native skill commands. From scripts, read skills with `workflow({action:"read",name})`.

## Tools

| Tools | Purpose |
| --- | --- |
| `workflow`, `verify` | Verbatim playbook steps, decisions, pause/resume, failing-first repros, and captured evidence |
| `delegate`, `panel` | Fresh Pi workers, independent reviews, arena candidates, optional judging |
| `capability` | Save executable JavaScript tools for a session, trusted project, or globally |
| `learn`, `recall`, `history` | Evidence-backed learned skills, workflow capsules, project-scoped Pi session mining |
| `settings`, `ask` | Verified model choices, role budgets, configuration, and user questions |
| `search`, `fetch`, `x_search`, `web` | Hosted search/fetch, native search where supported, live provider schemas |
| `control` | Browser-use and cua-driver readiness, approval-gated setup, explicit driving |
| `script`, `automation` | Orchestration, PR watching, plan checks, worktree audit, decision logs, bounded Benny proposals |

Tools are unprefixed. Use `describeTool(name)` or `searchTools(query)` inside codemode for exact schemas.

### Compose a workflow

The following is a codemode async body, not a shell command:

```js
const { run } = await tools.workflow({
  action: "start", name: "bug-fix", task: "Fix duplicate retry records",
});
const repro = await tools.verify({
  command: "npm test -- retry", label: "original failing repro", expectedExit: 1,
});
await tools.workflow({
  action: "step", id: run.id, step: "1", status: "done", evidence: [repro.id],
});
return { workflow: run.id, repro: repro.id };
```

Use Promise.allSettled for independent operations and await for dependencies. A failed script does not roll back earlier effects. Finished steps need evidence; skipped or blocked steps need reasons. Closing a workflow requires resolved steps and a passing zero-exit verification, not only a successful observation of a failure.

### Extend code, not bundled instructions

```js
await tools.capability({
  action: "save", scope: "session", name: "smoke", description: "Run the smoke check",
  code: 'return await tools.verify({command:"npm test",label:"smoke"});',
});
return await tools.capability({action: "run", name: "smoke", args: {}});
```

Pi snapshots the tool table per script. `tools.smoke({})` exists in the **next** codemode invocation; `capability(action="run")` runs it in the saving script. Capabilities have optional JSON parameter/output schemas and tool allowlists. They run in QuickJS without Node, direct filesystem, network, or timers; existing tools reach the host. Composition, memory, and execution are bounded.

Save reliable new recipes using `learn` with captured evidence IDs. Include the trigger, prerequisites, actions, verification, and recovery. Supporting scripts and evidence copies live with the learned skill. Names cannot shadow a bundled skill. Updating a learning requires `update:true` and codemax ownership. `recall` sees a new learning immediately; `/reload` refreshes Pi's skill list.

| Scope | Capabilities/settings | Learned skills |
| --- | --- | --- |
| Session | Active-branch Pi custom entries | Private temporary skill files referenced by the branch |
| Project | `.pi/codemax/` | `.pi/skills/<name>/` |
| Global | `~/.pi/agent/codemax/` | `~/.pi/agent/skills/<name>/` |

`PI_CODING_AGENT_DIR` relocates the agent directory. Project resources require Pi project trust. Precedence is defaults, global, project, then session. Session workflows, settings, evidence, and capabilities restore from the active branch; global/project filesystem changes are not rolled back by branching.

## Web and login

The hosted MCP clients try anonymous access when no credential is configured; no separate MCP setup is needed. Exa and Parallel keyless search/fetch succeeded in live probes. Firecrawl connected but rejected anonymous operations in this environment, so use account-backed access when required. Anonymous access is provider-controlled, not guaranteed.

| Provider | Anonymous MCP endpoint | OAuth command |
| --- | --- | --- |
| Exa | `https://mcp.exa.ai/mcp` | `/login exa` |
| Firecrawl | `https://mcp.firecrawl.dev/v2/mcp` | `/login firecrawl` |
| Parallel | `https://search.parallel.ai/mcp` | `/login parallel` |

OAuth uses Pi's credential store, MCP discovery, PKCE, verified callback state, and refresh. Account-backed endpoints are selected automatically after login. Optional `EXA_API_KEY`, `FIRECRAWL_API_KEY`, and `PARALLEL_API_KEY` are also supported through secure headers, never URL query secrets. Providers have no fake chat models. Limits, pricing, and tool availability remain provider-controlled.

```js
return await tools.search({query: "current release notes", provider: "parallel"});
// In another script:
return await tools.fetch({urls: ["https://example.com/"], provider: "firecrawl"});
```

Auto provider fallback reports every earlier failure. Inspect `web({action:"tools",provider:"exa"})` for live schemas and optional capabilities. Extra remote capabilities require user approval even when their unverified metadata claims read-only behavior; missing UI fails closed.

Native search is limited to verified GPT/OpenAI Responses routes and Grok/xAI Responses routes, not names behind arbitrary proxies:

- **GPT:** Native in-conversation web search replaces script `search`; `fetch` remains. Set `web.nativeInConversation:false` to retain script search.
- **Grok:** Native web search plus X search; script `search`, `fetch`, and `x_search` remain composable.
- **Other families/routes:** Exa, Firecrawl, and Parallel only. No fabricated native or X tool.

Native endpoint/model support and account permissions still apply. Disable `web.native` if the selected route rejects server-side tools. Live native-model requests and interactive OAuth sign-in are not validated by the offline tests.

## Browser and desktop

Browser-use and cua-driver instructions and available references are bundled. The Cua source pack is Linux-filtered; macOS/Windows references must be consulted on demand. Their binaries, browser sessions, daemons, OS permissions, and cloud browsers are not installed or provisioned.

Read the matching skill, then use `control({driver:"browser-use",action:"status"})` or the cua-driver equivalent. If unavailable/unconfigured, `action:"setup"` requests approval **before** consulting setup guidance. In headless mode it reports approval_required; it never assumes consent. Software installation, permission changes, shared-service restarts, foreground takeover, and paid remote browsers retain separate grants.

Observe an exact target, act once, then verify fresh state. Exit zero is not a user-outcome check. Use one controller for a shared desktop/browser; worktrees do not isolate focus.

## Delegation and long runs

Workers start fresh with a scoped brief and optional bundled `agent` profile. Nested spawning is off unless `allowDelegation:true` is explicitly granted; depth is capped at three. `settings` validates actual available model IDs. Budgets request medium/high/xhigh/max and Pi clamps to each model's supported tier.

Read-only is default. Writers require `readOnly:false,isolate:true` and clean committed parent HEAD. Each gets a detached worktree; the lead retains its commits, inspects diffs, reruns proof, and explicitly integrates. Nothing auto-merges, pushes, or cleans up candidate checkouts. Retain a branch before removing a detached worktree with unique commits.

A panel uses your explicit candidate/reviewer briefs, rotates configured role seats, returns failures, and can judge only after candidates settle. Unconfigured judges inherit the parent; no other model is silently substituted. Same-family or mixed-family review is not called cross-model proof against every candidate.

Orch is a locked plain-file/TSV coordinator with a verdict ledger, merge frontier, gates, and inbox pointers. Frontier discovery currently requires Graphite `gt`; `--prs` pins expected order, not an alternative discovery path. Watch-pr requires `gh`. Both TypeScript CLIs require Bun. Worktree audit is a portable Node inventory and performs no fetch or deletion.

There is no bundled cloud provisioning, agent-resume service, Automations editor, or wake scheduler. Configure persistent hosts explicitly. Benny `automation` rounds return proposed thread/tracker actions and local artifacts; the parent owns authorized external writes. No scheduling, credential setup, external posting, merge, or deployment is silently enabled.

## Safety and verification

Bundled `resources/` are immutable at runtime. File hooks resolve symlink aliases; shell guards reject identifiable bundle mutations. Extend executable code/scripts or save separate learnings. Read-only and path policies are **best-effort tool guards, not an OS security sandbox**. Host tools and packages run with the user's permissions; use isolated OS environments and narrow credentials for untrusted work. Prompt/log/page/subagent content never grants authorization.

```sh
npm run check
npm test
npm run test:ported   # Bun required
npm run test:all
npm audit --audit-level=high
npm run check:package
```

[CI](.github/workflows/ci.yml) runs on pushes to `main`, pull requests, and manual dispatch. Both Node 22.19.0 (the minimum) and Node 24 run type-checking, all extension/ported tests, the dependency audit, and package-content validation with Bun 1.4.2. Actions are pinned to commit hashes, the token is read-only, and no publishing or deployment is configured. Tests use local fixtures rather than account credentials.

Tests include real Pi sessions, an actual Pi CLI child against a local protocol server, delegate-process fixtures, mocked MCP transports/auth routing, branch restoration, evidence, and file guards. Live keyless Exa and Parallel search/fetch were also probed successfully. Firecrawl connected but rejected anonymous search/fetch in this environment; that provider error remains visible. Interactive OAuth, native-model requests, and GUI operation remain unverified.

See [Pi execution binding](resources/PI_BINDING.md), [guide](resources/docs/guide/README.md), and [provenance](NOTICE.md). MIT license; upstream copyrights retained.
