import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { bashData, hostShell } from "./control.ts";
import { scriptRoot } from "./paths.ts";
import { dataResult, dataSchema } from "./output.ts";
import { shellQuote } from "./process.ts";
import { enumSchema } from "./schema.ts";

export const scriptSpecs = {
  "orch": { path: join(scriptRoot, "ultracode", "orch", "orch.ts"), runner: "bun", description: "Durable locked plain-file coordinator. Typed units, phases, claims, inbox pointers, evidence-bound verdicts, merge gates and recovery. Read --help before use. No workers or merges are launched automatically." },
  "watch-pr": { path: join(scriptRoot, "ultracode", "watch-pr", "watch-pr"), runner: "bun", description: "Bounded GitHub PR/stack monitor. Distinguishes CI readiness from independent proof. JSON output. Read --help first; use --status-only for a single check." },
  "check-plan": { path: join(scriptRoot, "ultracode", "check-plan.mjs"), runner: "node", description: "Validate multi-phase dependency plans before starting work." },
  "worktree-audit": { path: join(scriptRoot, "ultracode", "worktree-audit.mjs"), runner: "node", description: "Read-only worktree inventory. Dirty work, merge state, age, size and cleanup candidates. Never deletes worktrees." },
  "decision-log": { path: join(scriptRoot, "show-me-your-work", "log.sh"), runner: "bash", description: "Append auditable TSV decision rows and render decisions. Inspect usage before writing." },
};
export function registerScripts(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "script", label: "Script", exposure: "codemode", description: "List or run ported executable capabilities: durable orchestration, PR/stack monitoring, plan validation, worktree audit, decision logging. Code/scripts may be extended; bundled prose may not. Calls use Pi's bash pipeline so permissions and hooks are preserved. No dependency bootstrap installs software.",
    parameters: Type.Object({ action: enumSchema(["list", "run"]), name: Type.Optional(enumSchema(["orch", "watch-pr", "check-plan", "worktree-audit", "decision-log"])), args: Type.Optional(Type.Array(Type.String())), timeout: Type.Optional(Type.Number({ minimum: 1, maximum: 14400 })) }), outputSchema: dataSchema,
    async execute(_id, params, signal, _update, ctx) {
      if (params.action === "list") return dataResult(scriptSpecs);
      if (!params.name) throw new Error("Select a script name.");
      const spec = scriptSpecs[params.name];
      const args = params.args ?? ["--help"];
      const shell = hostShell(ctx);
      const command = [spec.runner, shellQuote(spec.path, shell), ...args.map((arg) => shellQuote(arg, shell))].join(" ");
      return dataResult({ name: params.name, ...(await bashData(ctx, command, signal, params.timeout ?? 120)) });
    },
  });
}
