import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { bundleRoot } from "./paths.ts";
import { dataResult, dataSchema } from "./output.ts";
import { enumSchema } from "./schema.ts";
import { shellQuote } from "./process.ts";

export type Driver = "browser-use" | "cua-driver";
const setupPaths = { "browser-use": "https://github.com/browser-use/browser-harness/blob/main/install.md", "cua-driver": "https://cua.ai/docs/cua-driver" };
export function hostShell(ctx: ExtensionToolContext, platform: NodeJS.Platform = process.platform): "bash" | "powershell" {
  if (platform === "win32" && ctx.tools.some((tool) => tool.name === "powershell")) return "powershell";
  if (ctx.tools.some((tool) => tool.name === "bash")) return "bash";
  if (ctx.tools.some((tool) => tool.name === "powershell")) return "powershell";
  throw new Error("No callable shell. Activate bash or powershell before running this operation.");
}
export async function bashData(ctx: ExtensionToolContext, command: string, signal?: AbortSignal, timeout = 30): Promise<{ output: string; exit_code: number }> {
  const shell = hostShell(ctx);
  const outcome = await ctx.executeTool(shell, { command, timeout }, { signal });
  const value = outcome.result.structuredContent as { output: string; exit_code: number } | undefined;
  if (!value) throw new Error(outcome.result.content.filter((x) => x.type === "text").map((x) => x.text).join("\n"));
  return value;
}

export function registerControl(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "control", label: "Control", exposure: "codemode", executionMode: "sequential", description: "Preflight or drive browser-use (CDP) and cua-driver (native GUI). Use control-ui to choose a route, then read the selected bundled driver skill before driving. Setup guidance is read only after user approval. No auto-install, permission changes, desktop takeover, or shared-daemon restart. Drive observe -> act once -> verify with exact targets.",
    parameters: Type.Object({ driver: enumSchema(["browser-use", "cua-driver"]), action: enumSchema(["status", "setup", "run"]), script: Type.Optional(Type.String()), command: Type.Optional(Type.String()), args: Type.Optional(Type.Record(Type.String(), Type.Unknown())), timeout: Type.Optional(Type.Number({ minimum: 1, maximum: 3600 })) }), outputSchema: dataSchema,
    async execute(_id, params, signal, _update, ctx) {
      const driver: Driver = params.driver;
      const shell = hostShell(ctx);
      const installed = await bashData(ctx, shell === "powershell" ? "Get-Command " + driver + " -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source" : "command -v " + driver, signal);
      const missing = installed.exit_code !== 0 || !installed.output.trim();
      if (params.action === "setup") {
        if (!ctx.hasUI) return dataResult({ status: "approval_required", driver, message: "Ask the user to approve reading installation/setup guidance and helping configure " + driver + ". No setup has run.", guidance: setupPaths[driver] });
        if (!await ctx.ui.confirm("Help set up " + driver + "?", "Read setup guidance on demand and help configure this driver. Installation and permission changes require your approval.")) return dataResult({ status: "declined", driver });
        const guidance = driver === "cua-driver" ? { instructions: await readFile(join(bundleRoot, "skills", driver, "README.md"), "utf8"), runtime: await readFile(join(bundleRoot, "skills", driver, "RUNTIME.md"), "utf8") } : { url: setupPaths[driver], next: "Fetch this installation guide now, then explain the minimal platform-specific steps. Ask before installing software or changing permissions." };
        return dataResult({ status: "setup_approved", driver, guidance, missing });
      }
      if (missing) return dataResult({ status: "not_ready", driver, reason: "Executable missing.", next: "Ask for approval using control(action=setup) before reading installation guidance or installing." });
      const doctor = await bashData(ctx, driver === "browser-use" ? "browser-use --doctor" : "cua-driver doctor", signal, params.timeout ?? 30);
      if (doctor.exit_code !== 0) return dataResult({ status: "not_ready", driver, diagnostics: doctor.output, next: "Ask for setup approval. Do not silently change permissions, restart shared services, or upgrade software." });
      if (params.action === "status") return dataResult({ status: "ready", driver, executable: installed.output.trim(), diagnostics: doctor.output });
      let command: string;
      if (driver === "browser-use") {
        if (!params.script) throw new Error("Provide Python script for browser-use.");
        command = shell === "powershell" ? shellQuote(params.script, shell) + " | browser-use" : "printf '%s' " + shellQuote(params.script, shell) + " | browser-use";
      } else {
        if (!params.command || !/^[a-z][a-z0-9_]*$/.test(params.command)) throw new Error("Provide an advertised snake_case cua-driver tool command.");
        command = "cua-driver " + params.command + " " + shellQuote(JSON.stringify(params.args ?? {}), shell);
      }
      const result = await bashData(ctx, command, signal, params.timeout ?? 120);
      return dataResult({ driver, ...result, next: "Observe fresh state and verify the user's postcondition. Exit zero alone is not proof." });
    },
  });
}
