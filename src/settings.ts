import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Configuration, configSchema, parseConfig } from "./config.ts";
import { dataResult, dataSchema } from "./output.ts";
import { enumSchema } from "./schema.ts";

export function registerSettings(pi: ExtensionAPI, config: Configuration, onChange: (ctx: ExtensionContext) => Promise<void> | void): void {
  pi.registerTool({
    name: "settings", label: "Settings", exposure: "codemode", executionMode: "sequential", description: "Inspect available verified models or configure codemax's per-role panels, reasoning budget, web providers, and delegate concurrency. Scope session, trusted project, or global. Credential-free settings only. Use /login provider for web OAuth. Unavailable model ids are rejected, never guessed.",
    parameters: Type.Object({ action: enumSchema(["read", "models", "save"]), scope: Type.Optional(enumSchema(["session", "project", "global"])), config: Type.Optional(configSchema) }), outputSchema: dataSchema,
    async execute(_id, params, _signal, _update, ctx) {
      if (params.action === "models") return dataResult(ctx.modelRegistry.getAvailable().map(({ provider, id, name, api, reasoning, thinkingLevelMap }) => ({ provider, id, name, api, reasoning, thinkingLevelMap })));
      if (params.action === "save") {
        if (!params.config) throw new Error("Provide config to save.");
        const patch = parseConfig(params.config);
        const available = new Set(ctx.modelRegistry.getAvailable().flatMap((model) => [model.id, model.provider + "/" + model.id]));
        for (const [role, choice] of Object.entries(patch.roles ?? {})) for (const id of Array.isArray(choice) ? choice : [choice]) {
          if (!available.has(id) && id !== "inherit-parent" && id !== "auto") throw new Error("Unavailable model for " + role + ": " + id);
        }
        await config.save(params.scope ?? "session", ctx.cwd, ctx.isProjectTrusted(), patch);
        await onChange(ctx);
      }
      return dataResult(await config.read(ctx.cwd, ctx.isProjectTrusted()));
    },
  });
}
