import assert from "node:assert/strict";
import { dirname } from "node:path";
import test from "node:test";
import type { ExtensionAPI, ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, getCurrentTools } from "@earendil-works/pi-ai";
import { catalog } from "../src/catalog.ts";
import { testSession } from "./harness.ts";

test("bundled skills use Pi's native commands with no dedicated codemax commands", async () => {
  let getCommands: ExtensionAPI["getCommands"] = () => [];
  const h = await testSession([(pi) => { getCommands = () => pi.getCommands(); }]);
  try {
    const skills = (await catalog()).filter((entry) => entry.kind === "skill");
    const check = () => {
      assert.deepEqual(h.runtimeErrors, []);
      const commands = getCommands();
      assert.deepEqual(commands.filter((command) => command.source === "extension").map((command) => command.name), []);
      for (const skill of skills) {
        const discovered = commands.filter((command) => command.name === "skill:" + skill.name);
        assert.equal(discovered.length, 1, skill.name);
        assert.equal(discovered[0]?.source, "skill", skill.name);
      }
      for (const name of ["codemax", "ultracode", "setup-codemax", "ultracode-help"]) assert.ok(!commands.some((command) => command.name === name), name);
    };
    check();
    await h.session.reload();
    check();
  } finally { h.session.dispose(); }
});

test("native skill commands preserve the request and only-mode tools even with command discovery disabled", async () => {
  const h = await testSession([], { settings: { enableSkillCommands: false } });
  try {
    const skills = await catalog();
    for (const name of ["ultracode", "setup-codemax", "ultracode-help"]) {
      let declarations: string[] = [];
      h.faux.setResponses([(context) => {
        declarations = getCurrentTools(context.messages).map((tool) => tool.name);
        return fauxAssistantMessage("loaded");
      }]);
      const request = "Keep this exact request for " + name + "; do not install or save settings.";
      await h.session.prompt("/skill:" + name + " " + request);
      const entry = [...h.session.sessionManager.getBranch()].reverse().find((entry) => entry.type === "message" && entry.message.role === "user");
      assert.ok(entry?.type === "message" && entry.message.role === "user");
      const content = entry.message.content;
      const text = typeof content === "string" ? content : content.map((block) => block.type === "text" ? block.text : "").join("\n");
      const path = skills.find((skill) => skill.kind === "skill" && skill.name === name)!.path;
      assert.ok(text.startsWith('<skill name="' + name + '" location="' + path + '">'));
      assert.ok(text.includes("References are relative to " + dirname(path) + "."));
      assert.ok(text.includes("## Pi execution contract"));
      assert.ok(text.endsWith("</skill>\n\n" + request));
      assert.deepEqual(declarations, ["codemode"]);
    }
    assert.equal(h.settingsManager.getSettings().enableSkillCommands, false);
    assert.deepEqual(h.runtimeErrors, []);
  } finally { h.session.dispose(); }
});

test("codemax leaves the footer unchanged on startup and reload", async () => {
  const h = await testSession();
  const statuses: { key: string; text: string | undefined }[] = [];
  const uiContext = { setStatus: (key: string, text: string | undefined) => { statuses.push({ key, text }); } } as ExtensionUIContext;
  try {
    await h.session.bindExtensions({ mode: "tui", uiContext });
    assert.deepEqual(statuses, []);
    await h.session.reload();
    assert.deepEqual(statuses, []);
    assert.deepEqual(h.runtimeErrors, []);
    const result = await h.script("return 42;");
    assert.equal(result.isError, false);
    assert.deepEqual(statuses, []);
  } finally { h.session.dispose(); }
});
