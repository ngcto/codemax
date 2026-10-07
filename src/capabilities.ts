import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { CodemodeSandbox } from "@earendil-works/pi-codemode";
import { Type, type TSchema } from "typebox";
import { Value } from "typebox/value";
import { assertProjectScope, safeToolName, stateRoot, type Scope } from "./paths.ts";
import { atomicWrite, readJson } from "./storage.ts";
import { dataResult, dataSchema } from "./output.ts";
import { enumSchema } from "./schema.ts";
import { BranchState, type StoredCapability } from "./state.ts";

const definitionSchema = Type.Object({ name: Type.String(), description: Type.String({ minLength: 1, maxLength: 4096 }), code: Type.String({ minLength: 1, maxLength: 262144 }), parameters: Type.Record(Type.String(), Type.Unknown()), outputSchema: Type.Optional(Type.Record(Type.String(), Type.Unknown())), tools: Type.Optional(Type.Array(Type.String())) }, { additionalProperties: false });
export function parseCapability(value: unknown): StoredCapability {
  if (!Value.Check(definitionSchema, value)) throw new Error("Invalid capability definition.");
  safeToolName(value.name);
  if (value.parameters.type !== "object") throw new Error("Capability parameters must be an object JSON Schema.");
  return value;
}
export const reservedTools = new Set(["codemode", "workflow", "verify", "capability", "learn", "recall", "delegate", "panel", "ask", "settings", "search", "fetch", "x_search", "web", "control", "script", "automation", "history", "read", "bash", "edit", "write", "grep", "find", "ls", "powershell"]);

export class Capabilities {
  private installed = new Map<string, StoredCapability>();
  private owned = new Set<string>();
  constructor(private readonly pi: ExtensionAPI, private readonly state: BranchState) {}
  async restore(ctx: ExtensionContext): Promise<void> {
    const definitions = new Map<string, StoredCapability>();
    const scopes: ("global" | "project")[] = ctx.isProjectTrusted() ? ["global", "project"] : ["global"];
    for (const scope of scopes) {
      const dir = join(stateRoot(scope, ctx.cwd), "capabilities");
      let names: string[];
      try { names = await readdir(dir); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
      for (const name of names.sort().filter((name) => name.endsWith(".json"))) {
        const definition = parseCapability(await readJson(join(dir, name)));
        definitions.set(definition.name, definition);
      }
    }
    for (const definition of this.state.value.capabilities) definitions.set(definition.name, parseCapability(definition));
    for (const name of this.installed.keys()) if (!definitions.has(name)) this.withdraw(name);
    for (const definition of definitions.values()) this.install(definition);
  }
  private withdraw(name: string): void {
    const definition = this.installed.get(name);
    if (definition) this.pi.registerTool({ name, label: name, description: definition.description, parameters: Type.Unsafe(definition.parameters), exposure: "hidden", async execute() { throw new Error("Capability no longer exists on this branch."); } });
    this.installed.delete(name);
  }
  private checkName(name: string): void {
    safeToolName(name);
    if (reservedTools.has(name) || (!this.owned.has(name) && this.pi.getAllTools().some((tool) => tool.name === name))) throw new Error("Tool name is already owned: " + name + ". Extend it under a new unprefixed name.");
  }
  private install(definition: StoredCapability): void {
    this.checkName(definition.name);
    this.pi.registerTool({
      name: definition.name, label: definition.name, description: definition.description, parameters: Type.Unsafe(definition.parameters), outputSchema: definition.outputSchema ? Type.Unsafe(definition.outputSchema) : dataSchema, exposure: "codemode",
      async execute(_id, args, signal, _update, ctx) {
        return executeCapability(definition, args, ctx, signal);
      },
    });
    this.installed.set(definition.name, definition);
    this.owned.add(definition.name);
  }
  register(): void {
    this.pi.registerTool({
      name: "capability", label: "Capability", exposure: "codemode", executionMode: "sequential", description: "Create or extend an executable JavaScript capability without modifying bundled instructions. Scope session, project, or global. New tools are unprefixed and callable in the next codemode call. Use action=run to execute one inside the script that saved it. Code is an async body with args, tools, text, image, store, and load; no Node or direct network. Call existing tools to reach the host. Other capabilities may be composed freely.",
      parameters: Type.Object({ action: enumSchema(["list", "read", "save", "run"]), name: Type.Optional(Type.String()), scope: Type.Optional(enumSchema(["session", "project", "global"])), description: Type.Optional(Type.String()), code: Type.Optional(Type.String()), parameters: Type.Optional(Type.Record(Type.String(), Type.Unknown())), outputSchema: Type.Optional(Type.Record(Type.String(), Type.Unknown())), tools: Type.Optional(Type.Array(Type.String())), args: Type.Optional(Type.Record(Type.String(), Type.Unknown())) }), outputSchema: dataSchema,
      execute: async (_id, params, signal, _update, ctx) => {
        if (params.action === "list") return dataResult([...this.installed.values()].map(({ name, description }) => ({ name, description })));
        if (params.action === "read" || params.action === "run") {
          const definition = this.installed.get(params.name ?? "");
          if (!definition) throw new Error("Unknown custom capability.");
          if (params.action === "read") return dataResult(definition);
          if (!Value.Check(Type.Unsafe(definition.parameters), params.args ?? {})) throw new Error("Arguments do not match this capability's parameters.");
          return executeCapability(definition, params.args ?? {}, ctx, signal);
        }
        const definition = parseCapability({ name: params.name, description: params.description, code: params.code, parameters: params.parameters ?? { type: "object", properties: {}, additionalProperties: false }, ...(params.outputSchema ? { outputSchema: params.outputSchema } : {}), ...(params.tools ? { tools: params.tools } : {}) });
        this.checkName(definition.name);
        const scope: Scope = params.scope ?? "session";
        assertProjectScope(scope, ctx.isProjectTrusted());
        let path: string | undefined;
        if (scope === "session") this.state.commit((s) => { s.capabilities = [...s.capabilities.filter((x) => x.name !== definition.name), definition]; });
        else { path = join(stateRoot(scope, ctx.cwd), "capabilities", definition.name + ".json"); await atomicWrite(path, JSON.stringify(definition, null, 2) + "\n"); }
        this.install(definition);
        return dataResult({ name: definition.name, scope, path, available: "Named tool in the next codemode call; capability(action=run) in this one." });
      },
    });
  }
}

let activeCapabilityRuns = 0;
export async function executeCapability(definition: StoredCapability, args: unknown, ctx: ExtensionToolContext, signal?: AbortSignal) {
  if (activeCapabilityRuns >= 16) throw new Error("Capability composition/concurrency limit reached.");
  const allowed = ctx.tools.filter((tool) => tool.name !== "codemode" && tool.name !== definition.name && (!definition.tools || definition.tools.includes(tool.name)));
  const sandbox = new CodemodeSandbox({ memoryLimitBytes: 64 * 1024 * 1024, timeoutMs: 300000, tools: allowed.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: JSON.parse(JSON.stringify(tool.parameters)), outputSchema: tool.outputSchema ? JSON.parse(JSON.stringify(tool.outputSchema)) : undefined, async execute(input, nested) {
    const outcome = await ctx.executeTool(tool.name, input, { signal: nested.signal });
    if (tool.outputSchema && outcome.result.structuredContent !== undefined) return outcome.result.structuredContent;
    if (outcome.isError) throw new Error(outcome.result.content.filter((x) => x.type === "text").map((x) => x.text).join("\n"));
    return outcome.result.structuredContent ?? outcome.result.content.filter((x) => x.type === "text").map((x) => x.text).join("\n");
  } })) });
  activeCapabilityRuns++;
  try {
    const result = await sandbox.execute("const args = load('__args');\n" + definition.code, { signal, store: { __args: args } });
    if (!result.ok) throw new Error(result.error.message);
    const textOutput = result.output.filter((item) => item.type === "text");
    const value = result.value ?? { output: textOutput };
    if (definition.outputSchema && !Value.Check(Type.Unsafe(definition.outputSchema) as TSchema, value)) throw new Error("Capability output does not match its outputSchema.");
    // Pi accounts every ctx.executeTool result once, at every nesting depth.
    const response = dataResult(value);
    const images = result.output.filter((item) => item.type === "image");
    if (images.length) response.content.push(...images);
    return response;
  } finally { activeCapabilityRuns--; await sandbox.close(); }
}
