import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import type { Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionToolContext, SlashCommandInfo } from "@earendil-works/pi-coding-agent";
import { delegateProviderLoadout, registerDelegateModelGuard } from "../src/delegate-providers.ts";

const model = { provider: "fixture-proxy", id: "gpt-test", api: "fixture-responses" } as Model<string>;
function context(cwd: string, trusted = false): ExtensionToolContext {
  return { cwd, isProjectTrusted: () => trusted, modelRegistry: { getRegisteredProviderConfig: () => ({}) } } as unknown as ExtensionToolContext;
}
function command(path: string, scope: "user" | "project" = "user"): SlashCommandInfo {
  return { name: "fixture", source: "extension", sourceInfo: { path, scope, source: "local", origin: "top-level" } };
}
function withEnv(values: Record<string, string | undefined>): () => void {
  const original = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  return () => { for (const [key, value] of Object.entries(original)) if (value === undefined) delete process.env[key]; else process.env[key] = value; };
}

test("provider loadouts normalize explicit local paths for nested worktrees", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "codemax-provider-map-"));
  const path = join(cwd, "provider.ts");
  await writeFile(path, "throw new Error('DISCOVERY_MUST_NOT_EXECUTE');");
  const restore = withEnv({ CODEMAX_PROVIDER_EXTENSIONS: JSON.stringify({ [model.provider]: "./provider.ts" }) });
  try {
    const parent = await delegateProviderLoadout({} as ExtensionAPI, context(cwd), model);
    assert.deepEqual(parent.paths, [path]);
    assert.deepEqual(JSON.parse(parent.environment!), { [model.provider]: [path] });
    process.env.CODEMAX_PROVIDER_EXTENSIONS = parent.environment;
    const child = await delegateProviderLoadout({} as ExtensionAPI, context(join(cwd, "checkout")), model);
    assert.deepEqual(child.paths, parent.paths);
    process.env.CODEMAX_PROVIDER_EXTENSIONS = "{bad-json";
    await assert.rejects(delegateProviderLoadout({} as ExtensionAPI, context(cwd), model), /must be a JSON/);
    process.env.CODEMAX_PROVIDER_EXTENSIONS = JSON.stringify({ [model.provider]: "npm:unapproved-install" });
    await assert.rejects(delegateProviderLoadout({} as ExtensionAPI, context(cwd), model), /extension is missing/);
  } finally { restore(); }
});

test("provider discovery respects project trust and never executes candidate source", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "codemax-provider-trust-"));
  const agentDir = join(cwd, "agent");
  await mkdir(agentDir);
  const source = join(cwd, "provider.ts");
  await writeFile(source, 'throw new Error("DO_NOT_EXECUTE"); pi.registerProvider("fixture-proxy", {});');
  const pi = { getCommands: () => [command(source, "project")], getAllTools: () => [] } as unknown as ExtensionAPI;
  const restore = withEnv({ PI_CODING_AGENT_DIR: agentDir, CODEMAX_PROVIDER_EXTENSIONS: undefined });
  try {
    await assert.rejects(delegateProviderLoadout(pi, context(cwd, false), model), /Cannot locate/);
    const result = await delegateProviderLoadout(pi, context(cwd, true), model);
    assert.deepEqual(result.paths, [source]);
  } finally { restore(); }
});

test("provider discovery supports installed command-free native providers without installing missing packages", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "codemax-provider-package-"));
  const agentDir = join(cwd, "agent");
  const packageDir = join(cwd, "installed-provider");
  await mkdir(agentDir); await mkdir(packageDir);
  const source = join(packageDir, "index.ts");
  await writeFile(source, 'throw new Error("DO_NOT_EXECUTE"); pi.registerProvider({ id: "fixture-proxy" });');
  await writeFile(join(packageDir, "package.json"), JSON.stringify({ pi: { extensions: ["index.ts"] } }));
  const settings = JSON.stringify({ packages: [packageDir, "npm:codemax-deliberately-missing-provider@0.0.0"] });
  await writeFile(join(agentDir, "settings.json"), settings);
  const ctx = context(cwd);
  Object.assign(ctx.modelRegistry, { getRegisteredProviderConfig: () => undefined, getRegisteredNativeProvider: () => ({}) });
  const restore = withEnv({ PI_CODING_AGENT_DIR: agentDir, CODEMAX_PROVIDER_EXTENSIONS: undefined });
  try {
    const result = await delegateProviderLoadout({} as ExtensionAPI, ctx, model);
    assert.deepEqual(result.paths, [source]);
    assert.equal(await readFile(join(agentDir, "settings.json"), "utf8"), settings);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(delegateProviderLoadout({} as ExtensionAPI, ctx, model, controller.signal), { name: "AbortError" });
    assert.equal(result.paths[0], resolve(source));
  } finally { restore(); }
});


test("provider mappings validate entries and keep prototype-like IDs as ordinary keys", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "codemax-provider-keys-"));
  const path = join(cwd, "provider.ts");
  await writeFile(path, "export default function() {}");
  const restore = withEnv({ CODEMAX_PROVIDER_EXTENSIONS: undefined });
  try {
    const ctx = context(cwd);
    Object.assign(ctx.modelRegistry, { getRegisteredProviderConfig: () => undefined });
    for (const id of ["__proto__", "constructor", "toString"]) {
      assert.deepEqual((await delegateProviderLoadout({} as ExtensionAPI, ctx, { ...model, provider: id })).paths, []);
      process.env.CODEMAX_PROVIDER_EXTENSIONS = JSON.stringify(Object.fromEntries([[id, [path, path]]]));
      const loadout = await delegateProviderLoadout({} as ExtensionAPI, ctx, { ...model, provider: id });
      assert.deepEqual(loadout.paths, [path]);
      assert.deepEqual(Object.keys(JSON.parse(loadout.environment!)), [id]);
      delete process.env.CODEMAX_PROVIDER_EXTENSIONS;
    }
    for (const value of [null, [], "not-a-map", { [model.provider]: [] }, { [model.provider]: 1 }, { [model.provider]: [path, null] }, { [model.provider]: Array(9).fill(path) }, { " ": path }]) {
      process.env.CODEMAX_PROVIDER_EXTENSIONS = JSON.stringify(value);
      await assert.rejects(delegateProviderLoadout({} as ExtensionAPI, ctx, model), /CODEMAX_PROVIDER_EXTENSIONS/);
    }
    for (const name of ["plain.txt", "directory.ts"]) {
      const invalid = join(cwd, name);
      if (name.endsWith(".txt")) await writeFile(invalid, "text"); else await mkdir(invalid);
      process.env.CODEMAX_PROVIDER_EXTENSIONS = JSON.stringify({ [model.provider]: invalid });
      await assert.rejects(delegateProviderLoadout({} as ExtensionAPI, ctx, model), /must be a local JavaScript or TypeScript file/);
    }
  } finally { restore(); }
});

test("provider discovery ignores comments and unrelated literals and rejects configured ambiguity", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "codemax-provider-source-"));
  const agentDir = join(cwd, "agent");
  await mkdir(agentDir);
  const unrelated = join(cwd, "unrelated.ts");
  await writeFile(unrelated, '// pi.registerProvider("fixture-proxy", {});\npi.registerProvider("other", { description: "fixture-proxy" });\nconst example = \'pi.registerProvider("fixture-proxy", {})\';');
  const commands = [command(unrelated)];
  const pi = { getCommands: () => commands, getAllTools: () => [] } as unknown as ExtensionAPI;
  const restore = withEnv({ PI_CODING_AGENT_DIR: agentDir, CODEMAX_PROVIDER_EXTENSIONS: undefined });
  try {
    await assert.rejects(delegateProviderLoadout(pi, context(cwd), model), /Cannot locate/);
    const selected = join(cwd, "selected.ts");
    await writeFile(selected, 'const providerId = "fixture-proxy"; pi.registerProvider(providerId, {});');
    commands.push(command(selected));
    assert.deepEqual((await delegateProviderLoadout(pi, context(cwd), model)).paths, [selected]);
    const alternate = join(cwd, "alternate.ts");
    await writeFile(alternate, 'pi.registerProvider("fixture-proxy", {});');
    await writeFile(join(agentDir, "settings.json"), JSON.stringify({ extensions: [alternate] }));
    await assert.rejects(delegateProviderLoadout(pi, context(cwd), model), /Ambiguous delegate provider extension/);
    process.env.CODEMAX_PROVIDER_EXTENSIONS = JSON.stringify({ [model.provider]: selected });
    assert.deepEqual((await delegateProviderLoadout(pi, context(cwd), model)).paths, [selected]);
  } finally { restore(); }
});


test("delegate model guards block malformed contracts and missing extensions without changing valid providers", async () => {
  const restore = withEnv({ CODEMAX_DELEGATE_DEPTH: "1", CODEMAX_DELEGATE_MODEL: undefined });
  try {
    for (const contract of [JSON.stringify({ ...model, extension: false }), JSON.stringify({ ...model, extension: true }), "{bad-json", "null"]) {
      process.env.CODEMAX_DELEGATE_MODEL = contract;
      let guard!: () => Promise<void>;
      let blocked: { stream: () => void; streamSimple: () => void } | undefined;
      const pi = { on: (event: string, handler: (_event: unknown, ctx: ExtensionToolContext) => Promise<void>) => {
        assert.equal(event, "before_agent_start");
        const ctx = { model, modelRegistry: { find: () => model, getRegisteredProviderConfig: () => undefined, getRegisteredNativeProvider: () => undefined, getProvider: () => ({ id: model.provider }), registerProvider: (value: typeof blocked) => { blocked = value; } } } as unknown as ExtensionToolContext;
        guard = () => handler({}, ctx);
      } } as unknown as ExtensionAPI;
      registerDelegateModelGuard(pi);
      if (contract === JSON.stringify({ ...model, extension: false })) {
        await guard();
        assert.equal(blocked, undefined);
      } else {
        await assert.rejects(guard(), /Delegate requested exact model|Invalid delegate model contract/);
        assert.ok(blocked);
        assert.throws(() => blocked!.stream(), /Delegate requested exact model|Invalid delegate model contract/);
        assert.throws(() => blocked!.streamSimple(), /Delegate requested exact model|Invalid delegate model contract/);
      }
    }
  } finally { restore(); }
});
