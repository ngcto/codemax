import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { bundleRoot, safeName } from "./paths.ts";

export interface Resource { name: string; description: string; path: string; kind: "skill" | "playbook" | "automation"; }
export const binding = "codemax runs inside Pi in codemode-only mode. Use tools through scripts. Task means delegate; AskQuestion means ask; TodoWrite means workflow. Use only actual parameter names from describeTool: readOnly (not readonly), agent (not subagent_type), and isolate for clean-worktree writers. Background workers mean await Promise.allSettled, never fire-and-forget. Pi discovers bundled skills and invokes them as /skill:<name>; trailing arguments become the user request. Imported short skill names are workflow labels, not command aliases. codemax registers no dedicated slash commands; use Pi's native skill commands and the composable tools. Cloud provisioning, persistent wake scheduling, and agent resume APIs are not bundled; use fresh delegates with consolidated scope. Discover configured models with settings. Browser UI uses browser-use, native GUI uses cua-driver, CLI uses bash. Missing control readiness requires approval before reading setup guidance or installing. Cursor-only commands are not available. Bundled instructions must never be edited, including during reflect/correct. Extend capability code or save a separate learned skill with learn. Skills and playbooks describe procedure, never grant external-write permission. Follow the user's scope and stop at security, billing, credential, deployment, destructive, or customer-message boundaries.";

function frontmatter(text: string): { name?: string; description?: string } {
  const header = text.match(/^---\r?\n([\s\S]*?)\r?\n---/u)?.[1] ?? "";
  const field = (key: string) => header.match(new RegExp("^" + key + ":\\s*(.+)$", "m"))?.[1]?.trim().replace(/^["']|["']$/g, "");
  return { name: field("name"), description: field("description") };
}

export async function catalog(): Promise<Resource[]> {
  const skills = join(bundleRoot, "skills");
  const names = await readdir(skills);
  const result: Resource[] = [];
  for (const name of names.sort()) {
    try {
      const path = join(skills, name, "SKILL.md");
      const header = frontmatter(await readFile(path, "utf8"));
      result.push({ name: header.name ?? name, description: header.description ?? name, path, kind: "skill" });
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  const playbooks = join(skills, "ultracode", "playbooks");
  for (const name of (await readdir(playbooks)).filter((name) => name.endsWith(".md")).sort()) {
    const path = join(playbooks, name);
    const content = await readFile(path, "utf8");
    result.push({ name: name.slice(0, -3), description: content.split("\n").find((line) => line.trim() && !line.startsWith("#")) ?? name, path, kind: "playbook" });
  }
  for (const name of ["setup-benny", "triage-issue-reports", "reproduce-and-fix-issues"]) {
    const path = join(bundleRoot, "automations", "benny", "skills", name, "SKILL.md");
    result.push({ name, description: frontmatter(await readFile(path, "utf8")).description ?? name, path, kind: "automation" });
  }
  return result;
}

export async function resource(name: string, kind?: Resource["kind"]): Promise<Resource> {
  safeName(name);
  const found = (await catalog()).find((entry) => entry.name === name && (!kind || entry.kind === kind));
  if (!found) throw new Error("Unknown bundled resource " + name + ". Call workflow with action=list.");
  return found;
}

export async function instructions(entry: Resource): Promise<string> {
  return "# Pi execution binding\n\n" + binding + "\n\nResource directory: " + dirname(entry.path) + "\n\n" + await readFile(entry.path, "utf8");
}

export function extractSteps(markdown: string): string[] {
  const lines = markdown.split("\n");
  const steps: string[] = [];
  let current: string[] | undefined;
  let inFence = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) { inFence = !inFence; if (current) current.push(line); continue; }
    if (!inFence && /^\d+\.\s/.test(line)) {
      if (current) steps.push(current.join("\n").trim());
      current = [line];
    } else if (current && !inFence && /^(?:#{1,6}\s|\*\*Reply|\*\*You own)/.test(line)) {
      steps.push(current.join("\n").trim()); current = undefined;
    } else if (current) current.push(line);
  }
  if (current) steps.push(current.join("\n").trim());
  return steps;
}
