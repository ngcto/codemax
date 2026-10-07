# codemax

Rigorous workflows, review panels, and web tools for [Pi](https://pi.dev).

**Codemode-only:** the model sees one tool; scripts call Pi, MCP, and codemax tools.

## Install

Requires **Node 22.19+** and Pi (**1.0.4 tested**).

```sh
pi install git:github.com/ngcto/codemax
```

Run `/reload` or restart Pi.

Do not load another custom codemode executor. With `--tools`, include `codemode` and `workflow`.

## Use

```text
/skill:setup-codemax
/skill:ultracode <task>
/skill:ultracode-help
```

## Important

- Bundled instructions stay unchanged. Extend with `capability` or evidence-backed `learn`.
- Delegates default to read-only; writes require isolated worktrees. No automatic pushes or merges.
- Browser/desktop drivers need separate setup. Installation, paid services, and external writes require approval.
- Guards are **not an OS sandbox**. Project resources require Pi trust.

## Tools

| Tools | Purpose |
| --- | --- |
| `workflow`, `verify` | Playbooks and recorded proof |
| `delegate`, `panel` | Workers and review panels |
| `capability` | Saved executable tools |
| `learn`, `recall`, `history` | Evidence-backed learning and session recall |
| `settings`, `ask` | Model choices and user questions |
| `search`, `fetch`, `x_search`, `web` | Web providers and native search |
| `control` | Browser/desktop checks and approval-gated setup |
| `script`, `automation` | PR watching, plan checks, orchestration, Benny proposals |

## Web

- Default `auto`: native GPT/Grok search when supported; otherwise **Exa → Firecrawl → Parallel**.
- Login: `/login exa`, `/login firecrawl`, `/login parallel`.
- Anonymous access is provider-controlled; Firecrawl may require credentials.

## Development

```sh
npm ci
npm run test:all      # Bun required
npm audit --audit-level=high
npm run check:package
```

[CI](.github/workflows/ci.yml) checks Node 22.19 and 24: all tests, dependency audit, package contents.

Live OAuth, native-model requests, and GUI operation remain unverified.

[Guide](resources/docs/guide/README.md) · [Execution & safety](resources/PI_BINDING.md) · [Provenance](NOTICE.md) · [MIT](LICENSE)
