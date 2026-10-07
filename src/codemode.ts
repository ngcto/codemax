import { createCodemodeExtension, type ExtensionAPI, type ToolDefinition, type ToolLoadout } from "@earendil-works/pi-coding-agent";

export function createCodemodeLoadout(pi: ExtensionAPI) {
  // Capture Pi's maintained definition without claiming its name during extension loading.
  // Otherwise the loader omits builtin:codemode and emits a replacement warning.
  let captured: { name: string; parameters: ToolDefinition["parameters"]; prepareLoadout: NonNullable<ToolDefinition["prepareLoadout"]>; register(): void } | undefined;
  const executorApi = Object.create(pi) as ExtensionAPI;
  executorApi.registerTool = (definition) => {
    const prepare = definition.prepareLoadout;
    if (!prepare) throw new Error("Pi did not provide a codemode loadout hook.");
    const fixed = { ...definition, prepareLoadout(loadout: ToolLoadout) {
      const prepared = prepare(loadout);
      return { ...prepared, hiddenDeclarations: [...new Set([...(prepared?.hiddenDeclarations ?? []), ...loadout.declared.filter((tool) => tool.name !== "codemode").map((tool) => tool.name)])] };
    } };
    captured = { name: fixed.name, parameters: fixed.parameters, prepareLoadout: fixed.prepareLoadout, register: () => pi.registerTool(fixed) };
  };
  createCodemodeExtension({ mode: "only", models: true })(executorApi);
  if (!captured || captured.name !== "codemode") throw new Error("Pi did not provide a codemode loadout definition.");
  const executor = captured;
  let fallback = false;
  let failure: string | undefined = "codemax codemode loadout is not initialized.";
  const fail = (message: string): never => { failure = message; throw new Error(message); };
  pi.on("tool_call", (event) => {
    if (event.toolName === "codemode" && failure) return { block: true, reason: failure };
  });

  return {
    // workflow is the policy carrier; it remains script-callable and hides its own declaration.
    prepareLoadout: executor.prepareLoadout,
    activate() {
      failure = "codemax could not apply its codemode-only loadout.";
      let registered = pi.getAllTools().find((tool) => tool.name === "codemode");
      if (!registered && !fallback) {
        // session_start runs after built-ins have loaded. Supply a fallback only when absent.
        executor.register();
        fallback = true;
        registered = pi.getAllTools().find((tool) => tool.name === "codemode");
      }
      if (!registered || registered.exposure === "hidden") return fail("codemax requires codemode in the allowed tools. Check --tools and --exclude-tools.");
      if (registered.parameters !== executor.parameters || registered.exposure !== "model-only") fail("codemax requires Pi's maintained codemode executor. Disable the other custom codemode extension and reload.");
      const workflow = pi.getAllTools().find((tool) => tool.name === "workflow" && tool.exposure !== "hidden");
      if (!fallback && !workflow) fail("codemax requires workflow in the allowed tools to apply only mode to the built-in codemode. Include workflow in --tools and do not exclude it.");
      const active = pi.getActiveTools().filter((name) => name !== "codemode" && name !== "workflow");
      // Last hook wins descriptions. Do not deactivate host tools merely to hide their declarations.
      pi.setActiveTools([...active, "codemode", ...(workflow ? ["workflow"] : [])]);
      failure = undefined;
    },
  };
}
