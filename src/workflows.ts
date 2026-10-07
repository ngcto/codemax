import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { ToolDefinition, ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { catalog, extractSteps, instructions, resource } from "./catalog.ts";
import { dataResult, dataSchema } from "./output.ts";
import { BranchState } from "./state.ts";
import { enumSchema } from "./schema.ts";
import { hostShell } from "./control.ts";

export function registerWorkflows(pi: ExtensionAPI, state: BranchState, prepareLoadout?: ToolDefinition["prepareLoadout"]): void {
  pi.registerTool({
    name: "workflow", label: "Workflow", exposure: "codemode", executionMode: "sequential", prepareLoadout,
    description: "Read, start, checkpoint, pause, or finish an evidence-backed workflow. Lists all bundled skills/playbooks. Keeps steps verbatim, with explicit skip reasons. State follows the active Pi branch.",
    parameters: Type.Object({ action: enumSchema(["list", "read", "start", "status", "step", "decide", "pause", "resume", "finish", "append"]), name: Type.Optional(Type.String()), kind: Type.Optional(Type.Union([Type.Literal("skill"), Type.Literal("playbook"), Type.Literal("automation")])), task: Type.Optional(Type.String()), id: Type.Optional(Type.String()), step: Type.Optional(Type.String()), status: Type.Optional(Type.Union([Type.Literal("running"), Type.Literal("done"), Type.Literal("skipped"), Type.Literal("blocked")])), evidence: Type.Optional(Type.Array(Type.String())), reason: Type.Optional(Type.String()), decision: Type.Optional(Type.String()), steps: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: 50 })) }),
    outputSchema: dataSchema,
    async execute(_id, params) {
      if (params.action === "list") return dataResult(await catalog());
      if (params.action === "read") {
        const entry = await resource(params.name ?? "ultracode", params.kind);
        return dataResult({ ...entry, instructions: await instructions(entry) });
      }
      if (params.action === "start") {
        if (!params.task?.trim()) throw new Error("Starting a workflow requires a task.");
        const entry = await resource(params.name ?? "feature", params.kind ?? "playbook");
        const content = await readFile(entry.path, "utf8");
        const steps = extractSteps(content);
        if (!steps.length) steps.push("Follow the instructions in " + entry.path + ".");
        const run = { id: randomUUID(), name: entry.name, task: params.task, status: "active" as const, steps: steps.map((text, i) => ({ id: String(i + 1), text, status: "pending" as const, evidence: [] as string[] })), decisions: [] };
        state.commit((s) => s.workflows.push(run));
        return dataResult({ run, instructions: await instructions(entry) });
      }
      if (params.action === "status" && !params.id) return dataResult(state.value.workflows);
      const run = state.value.workflows.find((run) => run.id === params.id);
      if (!run) throw new Error("Unknown workflow id.");
      if (params.action === "status") return dataResult(run);
      const evidence = params.evidence ?? [];
      for (const id of evidence) if (!state.value.evidence.some((e) => e.id === id)) throw new Error("Unknown evidence id " + id + ". Use verify to capture command evidence.");
      if (params.action === "append") {
        if (run.status !== "active" || !params.steps?.length) throw new Error("Appending requires an active workflow and concrete steps.");
        state.commit((s) => { const target = s.workflows.find((x) => x.id === run.id)!; for (const text of params.steps!) target.steps.push({ id: String(target.steps.length + 1), text, status: "pending", evidence: [] }); });
      } else if (params.action === "step") {
        if (run.status !== "active") throw new Error("Resume the workflow before changing a step.");
        const step = run.steps.find((step) => step.id === params.step);
        if (!step || !params.status) throw new Error("Provide a valid step and status.");
        if ((params.status === "skipped" || params.status === "blocked") && !params.reason?.trim()) throw new Error("Skipped and blocked steps require a reason.");
        if (params.status === "done" && !evidence.length) throw new Error("Completed steps require captured evidence. Use skipped with a reason for a genuinely inapplicable step.");
        state.commit((s) => { const target = s.workflows.find((x) => x.id === run.id)!.steps.find((x) => x.id === step.id)!; target.status = params.status!; target.evidence = evidence; target.reason = params.reason; });
      } else if (params.action === "decide") {
        if (run.status !== "active") throw new Error("Decisions require an active workflow.");
        if (!params.decision?.trim()) throw new Error("Provide the decision.");
        state.commit((s) => s.workflows.find((x) => x.id === run.id)!.decisions.push({ at: new Date().toISOString(), decision: params.decision!, evidence }));
      } else if (params.action === "finish") {
        if (run.status !== "active") throw new Error("Resume the workflow before finishing it.");
        if (run.steps.some((step) => step.status !== "done" && step.status !== "skipped")) throw new Error("Finish or explicitly skip every step before closing the workflow.");
        if (!run.steps.some((step) => step.evidence.some((id) => state.value.evidence.some((e) => e.id === id && e.passed && e.expectedExit === 0)))) throw new Error("No passing verification evidence. The workflow cannot be complete.");
        state.commit((s) => { s.workflows.find((x) => x.id === run.id)!.status = "complete"; });
      } else if (params.action === "pause" || params.action === "resume") {
        if (run.status === "complete") throw new Error("A completed workflow cannot be resumed. Start a new run.");
        state.commit((s) => { s.workflows.find((x) => x.id === run.id)!.status = params.action === "pause" ? "paused" : "active"; });
      }
      return dataResult(state.value.workflows.find((x) => x.id === run.id));
    },
  });
  pi.registerTool({
    name: "verify", label: "Verify", exposure: "codemode", description: "Run a real repro, test, benchmark, or surface check through Pi's bash pipeline and retain evidence. Inconclusive and timed-out checks do not pass. Use expectedExit for a failing-first repro, then verify the fix separately.",
    parameters: Type.Object({ command: Type.String({ minLength: 1 }), label: Type.String({ minLength: 1 }), expectedExit: Type.Optional(Type.Integer()), expect: Type.Optional(Type.String()), timeout: Type.Optional(Type.Number({ minimum: 1, maximum: 3600 })) }), outputSchema: dataSchema,
    async execute(_id, params, signal, _update, ctx: ExtensionToolContext) {
      const shell = hostShell(ctx);
      const outcome = await ctx.executeTool(shell, { command: params.command, timeout: params.timeout ?? 120 }, { signal });
      const value = outcome.result.structuredContent as { output?: string; exit_code?: number; full_output_path?: string } | undefined;
      if (outcome.isError && value?.exit_code === undefined) throw new Error(outcome.result.content.filter((x) => x.type === "text").map((x) => x.text).join("\n"));
      const output = value?.output ?? outcome.result.content.filter((x) => x.type === "text").map((x) => x.text).join("\n");
      const details = outcome.result.details as { meta?: { exitCode?: number }; exitCode?: number } | undefined;
      const exitCode = value?.exit_code ?? details?.exitCode ?? details?.meta?.exitCode ?? null;
      const bounded = await import("./output.ts").then((m) => m.boundedText(output, "verification", 16000));
      const artifact = value?.full_output_path ?? bounded.artifact ?? await saveEvidence(output);
      const expectedExit = params.expectedExit ?? 0;
      const evidence = { id: randomUUID(), label: params.label, command: params.command, cwd: ctx.cwd, expectedExit, exitCode, passed: exitCode === expectedExit && (!params.expect || output.includes(params.expect)), output: bounded.text, artifact, timestamp: new Date().toISOString() };
      state.commit((s) => s.evidence.push({ ...evidence, output: evidence.output.slice(0, 4000) }));
      return dataResult(evidence);
    },
  });
}

async function saveEvidence(output: string): Promise<string> {
  const { mkdtemp, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const file = join(await mkdtemp(join(tmpdir(), "codemax-evidence-")), "output.txt");
  await writeFile(file, output, { mode: 0o600 });
  return file;
}
