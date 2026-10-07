import { lstatSync, readlinkSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export const packageRoot = fileURLToPath(new URL("../", import.meta.url));
export const bundleRoot = join(packageRoot, "resources");
export const scriptRoot = join(packageRoot, "scripts");
export type Scope = "session" | "project" | "global";

export function canonicalPath(path: string): string {
  const absolute = resolve(path);
  try { return realpathSync(absolute); }
  catch (error) { if (!["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error; }
  try {
    if (lstatSync(absolute).isSymbolicLink()) return canonicalPath(resolve(dirname(absolute), readlinkSync(absolute)));
  } catch (error) { if (!["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error; }
  const parent = dirname(absolute);
  if (parent === absolute) return absolute;
  return join(canonicalPath(parent), relative(parent, absolute));
}

export function isWithin(root: string, path: string): boolean {
  const rel = relative(canonicalPath(root), canonicalPath(path));
  return rel === "" || (!rel.startsWith(".." + sep) && rel !== ".." && !isAbsolute(rel));
}

export function assertMutable(path: string): void {
  if (isWithin(bundleRoot, path)) throw new Error("Bundled codemax instructions are read-only. Extend a capability or save a separate learned skill.");
}

export function safeName(value: string): string {
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value) || value.length > 64) {
    throw new Error("Use a lowercase name with single hyphens, at most 64 characters.");
  }
  return value;
}

export function safeToolName(value: string): string {
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(value) || /^codemax(?:_|$)/.test(value)) {
    throw new Error("Use an unprefixed lowercase tool name with letters, numbers, and underscores.");
  }
  return value;
}

export function stateRoot(scope: Exclude<Scope, "session">, cwd: string, agentDir = getAgentDir()): string {
  return scope === "global" ? join(agentDir, "codemax") : join(cwd, ".pi", "codemax");
}

export function skillRoot(scope: Exclude<Scope, "session">, cwd: string, agentDir = getAgentDir()): string {
  return scope === "global" ? join(agentDir, "skills") : join(cwd, ".pi", "skills");
}

export function assertProjectScope(scope: Scope, trusted: boolean): void {
  if (scope === "project" && !trusted) throw new Error("Project trust is required for project-scoped codemax resources.");
}
