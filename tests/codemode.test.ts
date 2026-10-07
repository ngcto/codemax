import assert from "node:assert/strict";
import test from "node:test";
import { createToolSearchExtension } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, getCurrentTools } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { testSession } from "./harness.ts";

const output = (result: { content: { type: string; text?: string }[] }) => result.content.map((block) => block.text ?? "").join("\n");

test("enabled built-in codemode is reused without warnings or duplicate registrations, including reload", async () => {
  const h = await testSession([], { builtinCodemode: true, settings: { codemode: { mode: "on" } } });
  try {
    const check = () => {
      const loaded = h.loader.getExtensions();
      assert.deepEqual(loaded.errors, []);
      assert.deepEqual(h.runtimeErrors, []);
      assert.deepEqual(loaded.warnings ?? [], []);
      const owners = loaded.extensions.filter((extension) => extension.tools.has("codemode"));
      assert.deepEqual(owners.map((extension) => extension.path), ["builtin:codemode"]);
      assert.equal(h.session.getAllTools().find((tool) => tool.name === "codemode")?.sourceInfo.path, "builtin:codemode");
      assert.equal(h.settingsManager.getSettings().codemode?.mode, "on", "do not rewrite user settings");
    };
    check();
    const result = await h.script('return await tools.verify({command:"pwd",label:"built-in executor proof"});');
    assert.equal(result.isError, false, output(result));
    assert.match(output(result), /"passed":true/);
    await h.session.reload();
    check();
    const reloaded = await h.script('return await tools.workflow({action:"list"});');
    assert.equal(reloaded.isError, false, output(reloaded));
  } finally { h.session.dispose(); }
});

test("built-in reuse still hides every other declaration without changing host activation or callability", async () => {
  const h = await testSession([
    { name: "tool-search", factory: createToolSearchExtension(), builtin: true, replaceable: true },
    (pi) => pi.registerTool({ name: "external_question", label: "External", exposure: "model-only", description: "unrelated tool", parameters: Type.Object({}), async execute() { return { content: [{ type: "text", text: "ok" }], details: null }; } }),
  ], { builtinCodemode: true, settings: { codemode: { mode: "on" }, defaultTools: ["read", "bash", "codemode", "tool_search"] } });
  try {
    assert.deepEqual(h.runtimeErrors, []);
    assert.ok(h.session.getActiveToolNames().includes("tool_search"), "hiding a host declaration must not deactivate it");
    const active = h.session.getActiveToolNames().slice().sort();
    let names: string[] = [], description = "";
    h.faux.setResponses([(context) => {
      const tools = getCurrentTools(context.messages);
      names = tools.map((tool) => tool.name);
      description = tools.find((tool) => tool.name === "codemode")?.description ?? "";
      return fauxAssistantMessage("checked");
    }]);
    await h.session.prompt("Check the tool declarations.");
    assert.deepEqual(names, ["codemode"]);
    assert.match(description, /### `read`/);
    assert.deepEqual(h.session.getActiveToolNames().slice().sort(), active);
    const result = await h.script('return {read:"read" in tools,write:"write" in tools,question:"external_question" in tools,toolSearch:"tool_search" in tools,models:typeof models.getModelsOfType};');
    assert.equal(result.isError, false, output(result));
    assert.match(output(result), /"read":true/);
    assert.match(output(result), /"write":false/);
    assert.match(output(result), /"question":false/);
    assert.match(output(result), /"toolSearch":false/);
    assert.match(output(result), /"models":"function"/);
  } finally { h.session.dispose(); }
});

test("disabled built-in codemode gets one maintained fallback and survives reload", async () => {
  const h = await testSession([], { builtinCodemode: true, settings: { extensions: ["-builtin:codemode"], codemode: { mode: "on" } } });
  try {
    const check = () => {
      const loaded = h.loader.getExtensions();
      assert.deepEqual(loaded.warnings ?? [], []);
      assert.deepEqual(h.runtimeErrors, []);
      assert.ok(!loaded.extensions.some((extension) => extension.path === "builtin:codemode"));
      assert.equal(loaded.extensions.filter((extension) => extension.tools.has("codemode")).length, 1);
    };
    check();
    const first = await h.script('store("fallback",41); return await tools.verify({command:"pwd",label:"fallback proof"});');
    assert.equal(first.isError, false, output(first));
    await h.session.reload();
    check();
    const second = await h.script('return load("fallback")+1;');
    assert.equal(second.isError, false, output(second));
    assert.match(output(second), /42/);
    h.session.sessionManager.branch(h.session.sessionManager.getBranch()[0]!.id);
    await h.session.bindExtensions({ mode: "print" });
    const branched = await h.script('return {stored:load("fallback") ?? null};');
    assert.equal(branched.isError, false, output(branched));
    assert.match(output(branched), /"stored":null/);
  } finally { h.session.dispose(); }
});

test("host tool exclusions are preserved with built-in codemode", async () => {
  const h = await testSession([], { builtinCodemode: true, excludeTools: ["write", "edit"] });
  try {
    assert.deepEqual(h.runtimeErrors, []);
    const result = await h.script('return {read:"read" in tools,write:"write" in tools,edit:"edit" in tools};');
    assert.equal(result.isError, false, output(result));
    assert.match(output(result), /"read":true/);
    assert.match(output(result), /"write":false/);
    assert.match(output(result), /"edit":false/);
    assert.ok(!h.session.getAllTools().some((tool) => ["write", "edit"].includes(tool.name)));
  } finally { h.session.dispose(); }
});

test("built-in tool allowlist must keep the only-mode policy hook and fails closed when missing", async () => {
  for (const workflow of [false, true]) {
    const h = await testSession([], { builtinCodemode: true, tools: ["read", "codemode", ...(workflow ? ["workflow"] : [])] });
    try {
      const result = await h.script('return {read:"read" in tools,write:"write" in tools};');
      if (workflow) {
        assert.deepEqual(h.runtimeErrors, []);
        assert.equal(result.isError, false, output(result));
        assert.match(output(result), /"read":true/);
        assert.match(output(result), /"write":false/);
      } else {
        assert.ok(h.runtimeErrors.some((error) => error.error.includes("requires workflow")));
        assert.equal(result.isError, true);
        assert.match(output(result), /requires workflow/);
      }
    } finally { h.session.dispose(); }
  }
});

test("a foreign codemode executor is not silently wrapped or replaced", async () => {
  let executed = false;
  const h = await testSession([(pi) => pi.registerTool({ name: "codemode", label: "Foreign", exposure: "model-only", description: "Not Pi's executor", parameters: Type.Object({ code: Type.String() }), async execute() { executed = true; return { content: [{ type: "text", text: "foreign" }], details: null }; } })]);
  try {
    assert.ok(h.runtimeErrors.some((error) => error.error.includes("maintained codemode executor")));
    const result = await h.script("return 42;");
    assert.equal(result.isError, true);
    assert.match(output(result), /maintained codemode executor/);
    assert.equal(executed, false);
    assert.equal(h.loader.getExtensions().extensions.filter((extension) => extension.tools.has("codemode")).length, 1);
  } finally { h.session.dispose(); }
});
