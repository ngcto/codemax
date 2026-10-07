import assert from "node:assert/strict";
import { readFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { fauxAssistantMessage, fauxToolCall, getCurrentTools } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { bundleRoot } from "../src/paths.ts";
import { dataResult, emptyUsage } from "../src/output.ts";
import { testSession } from "./harness.ts";

function textOf(result: { content: { type: string; text?: string }[] }): string { return result.content.map((x) => x.text ?? "").join("\n"); }

test("real Pi codemode calls nested tools and exposes only codemode", async () => {
  let declarations: string[] = [];
  const h = await testSession();
  try {
    h.faux.setResponses([(context) => { declarations = getCurrentTools(context.messages).map((x) => x.name); return fauxAssistantMessage(fauxToolCall("codemode", { code: "return await tools.verify({command:\"printf tested\",label:\"runtime proof\",expect:\"tested\"});" }), { stopReason: "toolUse" }); }, fauxAssistantMessage("done")]);
    await h.session.prompt("Run a verification.");
    assert.deepEqual(declarations, ["codemode"]);
    const entry = h.session.sessionManager.getBranch().find((entry) => entry.type === "message" && entry.message.role === "toolResult");
    assert.ok(entry);
    const state = h.session.sessionManager.getBranch().find((entry) => entry.type === "custom" && entry.customType === "codemax-state");
    assert.equal((state?.type === "custom" ? state.data as { evidence: { passed: boolean }[] } : undefined)?.evidence[0]?.passed, true);
  } finally { h.session.dispose(); }
});

test("failing-first repro captures a nonzero exit without losing structured evidence", async () => {
  const h = await testSession();
  try {
    const result = await h.script('return await tools.verify({command:"printf reproduced; exit 7",label:"original failure",expectedExit:7,expect:"reproduced"});');
    assert.equal(result.isError, false, textOf(result));
    assert.match(textOf(result), /"passed":true/);
    assert.match(textOf(result), /"exitCode":7/);
  } finally { h.session.dispose(); }
});

test("custom capabilities run in the saving script and refresh by name next script", async () => {
  const h = await testSession();
  try {
    const definition = { action: "save", name: "twice", description: "Run two independent checks", code: 'return await Promise.allSettled([tools.verify({command:"printf one",label:"one"}),tools.verify({command:"printf two",label:"two"})]);' };
    const code = 'await tools.capability(' + JSON.stringify(definition) + '); return await tools.capability({action:"run",name:"twice",args:{}});';
    const initial = await h.script(code);
    assert.equal(initial.isError, false, textOf(initial));
    const result = await h.script('return await tools.twice({});');
    assert.equal(result.isError, false, textOf(result));
    assert.match(textOf(result), /"fulfilled"/);
    assert.match(textOf(result), /"one"/);
    assert.match(textOf(result), /"two"/);
  } finally { h.session.dispose(); }
});

test("nested capability usage is accounted exactly once by Pi", async () => {
  const usage = { ...emptyUsage(), input: 3, output: 4, totalTokens: 7 };
  const h = await testSession([(pi) => { pi.registerTool({ name: "meter", label: "Meter", exposure: "codemode", description: "Local usage fixture", parameters: Type.Object({}), outputSchema: Type.Unknown(), async execute() { return dataResult({ ok: true }, usage); } }); }]);
  try {
    const saved = await h.script('await tools.capability({action:"save",name:"inner_meter",description:"inner",code:"return await tools.meter({});"}); await tools.capability({action:"save",name:"outer_meter",description:"outer",code:"return await tools.inner_meter({});"});');
    assert.equal(saved.isError, false, textOf(saved));
    const result = await h.script('return await tools.outer_meter({});');
    assert.equal(result.isError, false, textOf(result));
    assert.equal(result.usage?.totalTokens, 7);
  } finally { h.session.dispose(); }
});

test("bundled prose cannot be changed via a direct or symlinked file tool", async () => {
  const h = await testSession();
  try {
    const path = join(bundleRoot, "skills", "ultracode", "SKILL.md");
    const original = await readFile(path, "utf8");
    const result = await h.script('return await tools.write({path:' + JSON.stringify(path) + ',content:"tampered"});');
    assert.equal(result.isError, true);
    assert.match(textOf(result), /read-only/);
    assert.equal(await readFile(path, "utf8"), original);
    const dangling = join(h.cwd, "dangling-bundle-alias");
    await symlink(join(bundleRoot, "nonexistent-test-target"), dangling);
    const throughDangling = await h.script('return await tools.write({path:' + JSON.stringify(dangling) + ',content:"tampered"});');
    assert.equal(throughDangling.isError, true);
    assert.match(textOf(throughDangling), /read-only/);
  } finally { h.session.dispose(); }
});

test("learned skills are separate, evidence-backed, and recallable immediately", async () => {
  const h = await testSession();
  try {
    const result = await h.script('const evidence=await tools.verify({command:"printf recipe-ok",label:"recipe"}); const learned=await tools.learn({name:"recipe-test",description:"Repeat the verified recipe",scope:"session",instructions:"Run printf recipe-ok and assert the output. If it fails, inspect the environment.",evidence:[evidence.id]}); return await tools.recall({query:"recipe",includeInstructions:true});');
    assert.equal(result.isError, false, textOf(result));
    assert.match(textOf(result), /recipe-test/);
    assert.match(textOf(result), /Proven evidence/);
  } finally { h.session.dispose(); }
});
