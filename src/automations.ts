import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { bundleRoot, assertProjectScope, isWithin } from "./paths.ts";
import { atomicWrite } from "./storage.ts";
import { dataResult, dataSchema } from "./output.ts";
import { enumSchema } from "./schema.ts";
import type { Delegates } from "./delegates.ts";

async function files(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => entry.isDirectory() ? files(join(dir, entry.name)) : Promise.resolve([join(dir, entry.name)])))).flat();
}
export function registerAutomations(pi: ExtensionAPI, delegates: Delegates): void {
  pi.registerTool({
    name: "automation", label: "Automation", exposure: "codemode", executionMode: "sequential", description: "Ported Benny issue triage and reproduce/fix automation contracts. Describe them, scaffold a project-owned editable pack without overwriting local edits, or run one bounded delegate round on an exact report. No scheduler, credential setup, posting, merge, or deployment is silently enabled; the lead owns external writes and integration grants.",
    parameters: Type.Object({ action: enumSchema(["describe", "scaffold", "run"]), phase: Type.Optional(enumSchema(["triage", "reproduce"])), report: Type.Optional(Type.String()), configuration: Type.Optional(Type.String()), model: Type.Optional(Type.String()), timeout: Type.Optional(Type.Number({ minimum: 1, maximum: 14400 })) }), outputSchema: dataSchema,
    async execute(_id, params, signal, _update, ctx) {
      const source = join(bundleRoot, "automations", "benny");
      if (params.action === "describe") return dataResult({ instructions: await readFile(join(source, "FOR_AGENTS.md"), "utf8"), path: source, phases: ["triage", "reproduce"], integration: "Run these phases from an explicitly configured scheduler or webhook host using Pi print/JSON mode. The parent keeps source-thread coordinates immutable and owns all Slack/tracker writes. Delegates never receive chat credentials." });
      if (params.action === "scaffold") {
        assertProjectScope("project", ctx.isProjectTrusted());
        const destination = join(ctx.cwd, ".pi", "automations", "benny");
        const conflicts: string[] = [], copied: string[] = [];
        for (const path of await files(source)) {
          const rel = relative(source, path);
          const target = join(destination, rel);
          const content = await readFile(path, "utf8");
          let existing: string | undefined;
          try { existing = await readFile(target, "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
          if (existing !== undefined && existing !== content) { conflicts.push(target); continue; }
          if (existing === undefined) { await atomicWrite(target, content); copied.push(target); }
        }
        return dataResult({ destination, copied, conflicts, next: "Resolve conflicts without discarding user edits. Put user-owned configuration/maps under .pi/benny, secrets in the host's secret store. Configure and enable scheduling only after user approval and a dry run." });
      }
      if (!params.report?.trim() || !params.configuration?.trim() || !params.phase) throw new Error("A bounded automation round requires an exact report, phase, and configuration path. Missing coordinates/integrations fail closed.");
      if (!isWithin(ctx.cwd, resolve(ctx.cwd, params.configuration))) throw new Error("Automation configuration must live in the active repository.");
      const result = await delegates.run({ task: "Read the configured same-repository file " + params.configuration + ". Do not print secrets. Follow the exact report below within its configured budgets. Keep source channel/thread coordinates immutable. Stop for missing/uncertain coordinates, control readiness, ownership, duplicate state, or permissions. Return a proposed source-thread reply and tracker update only; do not send either. Draft PR only after before-and-after proof, no merge/deploy.\n\nReport:\n" + params.report, role: params.phase === "triage" ? "why investigators" : "bug-fix", model: params.model, skill: params.phase === "triage" ? "triage-issue-reports" : "reproduce-and-fix-issues", readOnly: params.phase === "triage", isolate: params.phase === "reproduce", timeout: params.timeout }, ctx, signal);
      return dataResult(result, result.usage);
    },
  });
}
