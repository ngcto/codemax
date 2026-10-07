import { mkdtemp, readdir, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { assertMutable, assertProjectScope, isWithin, safeName, skillRoot, type Scope } from "./paths.ts";
import { catalog } from "./catalog.ts";
import { atomicWrite } from "./storage.ts";
import { dataResult, dataSchema } from "./output.ts";
import { enumSchema } from "./schema.ts";
import { BranchState } from "./state.ts";

const marker = "codemax-learning: true";
export async function learnedSkills(roots: string[]): Promise<{ name: string; description: string; path: string; modified: number }[]> {
  const entries: { name: string; description: string; path: string; modified: number }[] = [];
  for (const root of roots) {
    let names: string[];
    try { names = await readdir(root); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
    for (const name of names) {
      const path = join(root, name, "SKILL.md");
      try {
        const content = await readFile(path, "utf8");
        if (!content.slice(0, 2048).includes(marker)) continue;
        const scalar = content.match(/^description: (.+)$/m)?.[1];
        const description = scalar ? JSON.parse(scalar) as string : name;
        entries.push({ name, description, path, modified: (await stat(path)).mtimeMs });
      } catch (error) { if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) continue; throw error; }
    }
  }
  return entries;
}

export function registerLearning(pi: ExtensionAPI, state: BranchState): void {
  pi.registerTool({
    name: "learn", label: "Learn", exposure: "codemode", executionMode: "sequential", description: "Save a validated, evidence-backed reusable skill outside the immutable bundle. Scope session, project, or global. Name the trigger, prerequisites, actions, verification, and failure recovery in instructions. Optional supporting script files are relative to the learned skill. Updating is limited to codemax-owned learned skills.",
    parameters: Type.Object({ name: Type.String(), description: Type.String({ minLength: 1, maxLength: 1024 }), instructions: Type.String({ minLength: 1, maxLength: 100000 }), scope: Type.Optional(enumSchema(["session", "project", "global"])), evidence: Type.Array(Type.String(), { minItems: 1 }), files: Type.Optional(Type.Record(Type.String(), Type.String())), update: Type.Optional(Type.Boolean()) }), outputSchema: dataSchema,
    async execute(_id, params, _signal, _update, ctx) {
      safeName(params.name);
      if ((await catalog()).some((entry) => entry.kind === "skill" && entry.name === params.name)) throw new Error("A bundled skill has that name. Save an extension with a different name.");
      const evidence = params.evidence.map((id) => { const found = state.value.evidence.find((e) => e.id === id); if (!found) throw new Error("Unknown evidence id " + id); return found; });
      const scope: Scope = params.scope ?? "project";
      assertProjectScope(scope, ctx.isProjectTrusted());
      const previous = scope === "session" ? state.value.learned.find((entry) => entry.name === params.name) : undefined;
      const root = scope === "session" ? previous ? dirname(dirname(previous.path)) : await mkdtemp(join(tmpdir(), "codemax-learning-")) : skillRoot(scope, ctx.cwd);
      const dir = join(root, params.name);
      const path = join(dir, "SKILL.md");
      assertMutable(path);
      const files = Object.entries(params.files ?? {});
      for (const [name] of files) {
        if (name === "SKILL.md" || name.startsWith("evidence/") || !name || name.startsWith("/") || name.includes("\\") || !isWithin(dir, join(dir, name))) throw new Error("Invalid supporting-file path " + name);
        assertMutable(join(dir, name));
      }
      const captured = await Promise.all(evidence.map(async (entry, index) => ({ entry, relativePath: "evidence/" + index + "-" + entry.id + ".txt", output: await readFile(entry.artifact, "utf8") })));
      const content = "---\nname: " + params.name + "\ndescription: " + JSON.stringify(params.description) + "\nmetadata:\n  " + marker + "\n---\n\n" + params.instructions.trim() + "\n\n## Proven evidence\n\n" + captured.map(({ entry: e, relativePath }) => "- " + e.label + ". " + (e.passed ? "Observed expected outcome" : "Observed failure") + ". Artifact: \x60" + relativePath + "\x60. Command: \x60" + e.command.replaceAll("\n", " ") + "\x60.").join("\n") + "\n";
      await withFileMutationQueue(path, async () => {
        let existing: string | undefined;
        try { existing = await readFile(path, "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        if (existing && (!params.update || !existing.slice(0, 2048).includes(marker))) throw new Error("Skill already exists. Only an explicit update of a codemax learning is allowed.");
        for (const [name, body] of files) await atomicWrite(join(dir, name), body);
        for (const capture of captured) await atomicWrite(join(dir, capture.relativePath), capture.output);
        await atomicWrite(path, content);
      });
      state.commit((s) => { s.learned = [...s.learned.filter((x) => x.path !== path), { name: params.name, description: params.description, path }]; });
      return dataResult({ name: params.name, path, scope, discovered: "Available through recall immediately; /reload refreshes Pi's skill list." });
    },
  });
  pi.registerTool({
    name: "recall", label: "Recall", exposure: "codemode", annotations: { readOnlyHint: true, openWorldHint: false }, description: "Find prior learned skills for a task, or return a tight active-branch workflow/evidence capsule. Searches only this session, the trusted project, and your global learned skills. Use history tools separately for explicitly requested transcript mining.",
    parameters: Type.Object({ query: Type.Optional(Type.String()), includeInstructions: Type.Optional(Type.Boolean()), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })) }), outputSchema: dataSchema,
    async execute(_id, params, _signal, _update, ctx) {
      const roots = [skillRoot("global", ctx.cwd), ...(ctx.isProjectTrusted() ? [skillRoot("project", ctx.cwd)] : [])];
      const persistent = await learnedSkills(roots);
      const candidates = [...persistent, ...state.value.learned.map((entry) => ({ ...entry, modified: Date.now() }))];
      const words = (params.query ?? "").toLowerCase().split(/\W+/).filter(Boolean);
      const matches = [...new Map(candidates.map((entry) => [entry.path, entry])).values()].map((entry) => ({ ...entry, score: words.reduce((total, word) => total + Number((entry.name + " " + entry.description).toLowerCase().includes(word)), 0) })).filter((entry) => !words.length || entry.score > 0).sort((a, b) => b.score - a.score || b.modified - a.modified).slice(0, params.limit ?? 8);
      const skills = await Promise.all(matches.map(async (entry) => ({ ...entry, ...(params.includeInstructions ? { instructions: await readFile(entry.path, "utf8").catch(() => "Learning artifact unavailable. Reverify before relying on it.") } : {}) })));
      return dataResult({ skills, workflows: state.value.workflows.map(({ id, name, task, status, steps }) => ({ id, name, task, status, pending: steps.filter((s) => s.status !== "done" && s.status !== "skipped").map(({ id, text, status }) => ({ id, text: text.slice(0, 300), status })) })), evidence: state.value.evidence.slice(-8).map(({ id, label, passed, artifact }) => ({ id, label, passed, artifact })) });
    },
  });
}
