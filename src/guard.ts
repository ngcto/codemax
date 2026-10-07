import { resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { bundleRoot, canonicalPath, isWithin } from "./paths.ts";

export function referencesBundle(command: string, cwd: string): boolean {
  const root = canonicalPath(bundleRoot);
  const variants = [root, bundleRoot, "resources/skills", "resources/agents", "resources/automations", "resources/docs"];
  if (variants.some((path) => command.includes(path))) return true;
  const tokens = command.match(/(?:[^\s'";|&<>]+|'[^']*'|"[^"]*")+/g) ?? [];
  return tokens.some((token) => {
    const value = token.replace(/^["']|["']$/g, "");
    try { const path = resolve(cwd, value); return isWithin(bundleRoot, path) || isWithin(path, bundleRoot); } catch { return false; }
  });
}
export function shellLooksReadOnly(command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed || /[;|&<>\n`]/.test(trimmed) || /\$\(/.test(trimmed)) return false;
  if (/^(?:pwd|ls|find|rg|grep|git status|git diff|git log|git show|git branch|git rev-parse|git ls-files|command -v|which|wc|du|df|head|tail)(?:\s|$)/.test(trimmed)) {
    return !/(?:--output|--exec|--delete|--replace|-exec|-execdir|-delete|-ok|-okdir|-fprint|-fprint0|-fprintf|-fls|--pre|--hostname-bin|--no-index|--open-files-in-pager)\b/.test(trimmed) && !/^git branch\s+(?!-a(?:\s|$)|-r(?:\s|$)|--list(?:\s|$))\S/.test(trimmed);
  }
  return /^(?:browser-use --doctor|cua-driver (?:--version|status|doctor|list-tools|describe \w+)|bun .+\/watch-pr\/(?:cli\.ts|watch-pr) .+--status-only)(?:\s|$)/.test(trimmed);
}

export function registerGuards(pi: ExtensionAPI): void {
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "codemode" && !event.parentToolCallId) return { block: true, reason: "codemax only mode: call this tool inside codemode scripts." };
    const input = event.input as Record<string, unknown>;
    if (process.env.CODEMAX_ALLOW_DELEGATION === "0" && ["delegate", "panel", "automation"].includes(event.toolName)) return { block: true, reason: "This worker has no nested delegation grant." };
    if (process.env.CODEMAX_WORKTREE && ["write", "edit"].includes(event.toolName) && typeof input.path === "string" && !isWithin(process.env.CODEMAX_WORKTREE, resolve(ctx.cwd, input.path))) return { block: true, reason: "Writable workers may only change their isolated worktree." };
    if (["write", "edit"].includes(event.toolName) && typeof input.path === "string" && isWithin(bundleRoot, resolve(ctx.cwd, input.path))) return { block: true, reason: "Bundled codemax instructions are read-only. Use capability or learn instead." };
    if (["bash", "powershell"].includes(event.toolName) && typeof input.command === "string") {
      if (referencesBundle(input.command, ctx.cwd) && !shellLooksReadOnly(input.command)) return { block: true, reason: "Shell mutations of bundled instructions are forbidden. Read them with read; extend code/scripts or learned skills separately." };
      if (process.env.CODEMAX_READONLY === "1" && !shellLooksReadOnly(input.command)) return { block: true, reason: "This delegate is read-only. Run non-mutating shell inspection, or ask the parent to assign an isolated writable worker." };
    }
    if (process.env.CODEMAX_DELEGATE_DEPTH && ["learn", "capability", "automation"].includes(event.toolName)) return { block: true, reason: "Shared extension and learning writes belong to the lead, not a delegate." };
    if (process.env.CODEMAX_READONLY === "1" && ["write", "edit", "learn", "capability", "automation"].includes(event.toolName)) return { block: true, reason: "This delegate has no mutation grant." };
    if (process.env.CODEMAX_READONLY === "1" && !["codemode", "read", "bash", "powershell", "grep", "find", "ls", "workflow", "verify", "recall", "history", "settings", "search", "fetch", "x_search", "web", "ask", ...(process.env.CODEMAX_ALLOW_DELEGATION === "1" ? ["delegate", "panel"] : [])].includes(event.toolName)) {
      const tool = pi.getAllTools().find((tool) => tool.name === event.toolName);
      if (!tool?.annotations?.readOnlyHint) return { block: true, reason: "Unverified mutating tool is unavailable in a read-only delegate." };
    }
    if (process.env.CODEMAX_DELEGATE_DEPTH && event.toolName === "settings" && input.action === "save" && input.scope !== "session") return { block: true, reason: "Shared settings belong to the lead, not a delegate." };
    if (process.env.CODEMAX_DELEGATE_DEPTH && event.toolName === "web" && input.action === "call") return { block: true, reason: "Delegate web access is search/fetch only." };
  });
  pi.on("user_bash", (event, ctx) => {
    if (referencesBundle(event.command, ctx.cwd) && !shellLooksReadOnly(event.command)) return { result: { output: "Bundled codemax instructions are read-only.", exitCode: 1, cancelled: false, truncated: false } };
  });
}
