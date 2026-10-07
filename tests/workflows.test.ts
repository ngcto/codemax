import assert from "node:assert/strict";
import { readFile, symlink, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxToolCall, getCurrentTools } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { bundleRoot } from "../src/paths.ts";
import { testSession } from "./harness.ts";
import { runProcess, shellQuote } from "../src/process.ts";

const output = (result: { content: { type: string; text?: string }[] }) => result.content.map((block) => block.text ?? "").join("\n");

test("workflow requires evidence, explicit skip reasons and a successful post-fix check", async () => {
  const h = await testSession();
  try {
    const result = await h.script('const run=await tools.workflow({action:"start",name:"prototype",task:"test a sketch"}); store("run",run.run.id); return run.run.steps;');
    assert.equal(result.isError, false, output(result));
    assert.match(output(result), /Establish|Throwaway|Frame|Frame|decision|sketch/i);
    const noEvidence = await h.script('return await tools.workflow({action:"step",id:load("run"),step:"1",status:"done"});');
    assert.equal(noEvidence.isError, true);
    assert.match(output(noEvidence), /require captured evidence/);
    const noReason = await h.script('return await tools.workflow({action:"step",id:load("run"),step:"1",status:"skipped"});');
    assert.equal(noReason.isError, true);
    const finished = await h.script('const proof=await tools.verify({command:"printf fixed",label:"live predicate",expect:"fixed"}); const run=await tools.workflow({action:"status",id:load("run")}); await tools.workflow({action:"step",id:run.id,step:"1",status:"done",evidence:[proof.id]}); for(const step of run.steps.slice(1)) await tools.workflow({action:"step",id:run.id,step:step.id,status:"skipped",reason:"not applicable to this harness test"}); return await tools.workflow({action:"finish",id:run.id});');
    assert.equal(finished.isError, false, output(finished));
    assert.match(output(finished), /"status":"complete"/);
  } finally { h.session.dispose(); }
});

test("workflow branches restore session capabilities and settings from only the active path", async () => {
  const h = await testSession();
  try {
    await h.script('return await tools.verify({command:"printf baseline",label:"baseline"});');
    const baseline = h.session.sessionManager.getLeafId()!;
    await h.script('await tools.settings({action:"save",scope:"session",config:{budget:"small"}}); return await tools.capability({action:"save",name:"branch_only",description:"branch local",code:"return 42;"});');
    const before = await h.script('return {value:await tools.branch_only({}),config:await tools.settings({action:"read"})};');
    assert.match(output(before), /"value":42/);
    assert.match(output(before), /"budget":"small"/);
    h.session.sessionManager.branch(baseline);
    await h.session.bindExtensions({ mode: "print" });
    const restored = await h.script('return {exists:"branch_only" in tools,config:await tools.settings({action:"read"})};');
    assert.equal(restored.isError, false, output(restored));
    assert.match(output(restored), /"exists":false/);
    assert.doesNotMatch(output(restored), /"budget":"small"/);
    const savedAgain = await h.script('return await tools.capability({action:"save",name:"branch_only",description:"new branch",code:"return 43;"});');
    assert.equal(savedAgain.isError, false, output(savedAgain));
  } finally { h.session.dispose(); }
});

test("only mode hides unrelated model-only tools too", async () => {
  const h = await testSession([(pi: ExtensionAPI) => pi.registerTool({ name: "external_question", label: "External", exposure: "model-only", description: "unrelated tool", parameters: Type.Object({}), async execute() { return { content: [{ type: "text", text: "ok" }], details: null }; } })]);
  try {
    let declarations: string[] = [];
    h.faux.setResponses([(context) => {
      declarations = getCurrentTools(context.messages).map((tool) => tool.name);
      return fauxAssistantMessage(fauxToolCall("codemode", { code: 'return await tools.settings({action:"read"});' }), { stopReason: "toolUse" });
    }, fauxAssistantMessage("done")]);
    await h.session.prompt("Read the settings.");
    assert.deepEqual(declarations, ["codemode"]);
  } finally { h.session.dispose(); }
});

test("real file protection resolves symlink aliases and shell mutations", async () => {
  const h = await testSession();
  try {
    const alias = join(h.cwd, "alias");
    await symlink(bundleRoot, alias, "dir");
    const path = join(alias, "skills", "ultracode", "SKILL.md");
    const original = await readFile(path, "utf8");
    const edit = await h.script('return await tools.write({path:' + JSON.stringify(path) + ',content:"bad"});');
    assert.equal(edit.isError, true);
    const shell = await h.script('return await tools.bash({command:' + JSON.stringify("printf bad > " + shellQuote(path)) + '});');
    assert.equal(shell.isError, true);
    assert.equal(await readFile(path, "utf8"), original);
  } finally { h.session.dispose(); }
});

test("saved learning retains evidence after original temporary artifacts are removed", async () => {
  const h = await testSession();
  try {
    const files = { "scripts/repro.js": 'console.log("persistent-proof")' };
    const result = await h.script('const e=await tools.verify({command:"printf persistent-proof",label:"persistent"});const s=await tools.learn({name:"persistent-recipe",description:"Persistent recipe",scope:"session",instructions:"Run the literal output check.",evidence:[e.id],files:' + JSON.stringify(files) + '});return {source:e.artifact,path:s.path};');
    assert.equal(result.isError, false, output(result));
    const match = output(result).match(/\{"source":"([^"]+)","path":"([^"]+)"\}/);
    assert.ok(match, output(result));
    const original = match[1]!, path = match[2]!;
    await rm(original);
    const skill = await readFile(path, "utf8");
    const rel = skill.match(/Artifact: \x60([^\x60]+)\x60/)?.[1];
    assert.ok(rel);
    assert.equal(await readFile(join(path, "..", rel), "utf8"), "persistent-proof");
  } finally { h.session.dispose(); }
});

test("process runner preserves UTF-8 boundaries, errors, and terminates ignored SIGTERM", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "codemax-process-test-"));
  const unicode = await runProcess(process.execPath, ["-e", "const b=Buffer.from('🙂');process.stdout.write(b.subarray(0,2));process.stdout.write(b.subarray(2));"], { cwd });
  assert.equal(unicode.stdout, "🙂");
  assert.equal(await readFile(unicode.stdoutPath, "utf8"), "🙂");
  await assert.rejects(runProcess("codemax-nonexistent-binary", [], { cwd }));
  if (process.platform !== "win32") {
    const canceled = await runProcess(process.execPath, ["-e", "process.on('SIGTERM',()=>{});setInterval(()=>{},1000);"], { cwd, timeoutMs: 80 });
    assert.equal(canceled.timedOut, true);
    assert.ok(canceled.elapsedMs < 3000);
  }
});
