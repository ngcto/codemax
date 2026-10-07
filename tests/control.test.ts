import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI, ExtensionToolContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { registerControl, hostShell } from "../src/control.ts";
import { shellQuote } from "../src/process.ts";
import { bundleRoot, packageRoot } from "../src/paths.ts";
import { registerAutomations } from "../src/automations.ts";
import type { Delegates } from "../src/delegates.ts";
import { shellLooksReadOnly, referencesBundle } from "../src/guard.ts";
import { testSession } from "./harness.ts";

function toolsOf(register: (pi: ExtensionAPI) => void) {
  const definitions = new Map<string, ToolDefinition>();
  register({ registerTool: (tool: ToolDefinition) => definitions.set(tool.name, tool) } as unknown as ExtensionAPI);
  return definitions;
}
function controlContext(exit: number, ui = false, approve = false) {
  let confirmations = 0;
  const commands: string[] = [];
  const ctx = { cwd: "/tmp", tools: [{ name: "bash" }], hasUI: ui, ui: { confirm: async () => { confirmations++; return approve; } }, async executeTool(_name: string, args: { command: string }) {
    commands.push(args.command);
    return { isError: exit !== 0, result: { content: [], details: null, structuredContent: { exit_code: exit, output: exit === 0 ? "/bin/driver" : "missing" } } };
  } } as unknown as ExtensionToolContext;
  return { ctx, commands, get confirmations() { return confirmations; } };
}

test("missing control requests setup approval without consulting guidance or auto-installing", async () => {
  const tool = toolsOf(registerControl).get("control")!;
  const h = controlContext(1);
  const missing = await tool.execute("call", { driver: "cua-driver", action: "status" }, undefined, undefined, h.ctx);
  assert.equal((missing.structuredContent as { status: string }).status, "not_ready");
  const headless = await tool.execute("call", { driver: "cua-driver", action: "setup" }, undefined, undefined, h.ctx);
  assert.equal((headless.structuredContent as { status: string }).status, "approval_required");
  assert.equal((headless.structuredContent as { instructions?: string }).instructions, undefined);
  assert.ok(h.commands.every((command) => command.startsWith("command -v") || command.startsWith("Get-Command")));
  const declined = controlContext(1, true, false);
  const no = await tool.execute("call", { driver: "cua-driver", action: "setup" }, undefined, undefined, declined.ctx);
  assert.equal((no.structuredContent as { status: string }).status, "declined");
  assert.equal(declined.confirmations, 1);
  const approved = controlContext(1, true, true);
  const yes = await tool.execute("call", { driver: "cua-driver", action: "setup" }, undefined, undefined, approved.ctx);
  const value = yes.structuredContent as { status: string; guidance: { instructions: string; runtime: string } };
  assert.equal(value.status, "setup_approved");
  assert.match(value.guidance.instructions, /cua-driver/);
  assert.match(value.guidance.runtime, /Runtime|runtime|preflight/i);
  assert.equal(approved.commands.length, 1);
});

test("driver command validation prevents shell command injection", async () => {
  const tool = toolsOf(registerControl).get("control")!;
  const h = controlContext(0);
  await assert.rejects(tool.execute("call", { driver: "cua-driver", action: "run", command: "click;rm", args: {} }, undefined, undefined, h.ctx), /advertised snake_case/);
  assert.equal(h.commands.length, 2);
});

test("host shell selection uses callable tools and quoting matches the selected shell", () => {
  const ctx = { tools: [{ name: "bash" }] } as unknown as ExtensionToolContext;
  assert.equal(hostShell(ctx, "win32"), "bash");
  const ps = { tools: [{ name: "bash" }, { name: "powershell" }] } as unknown as ExtensionToolContext;
  assert.equal(hostShell(ps, "win32"), "powershell");
  assert.equal(hostShell(ps, "linux"), "bash");
  assert.equal(shellQuote("a'b", "powershell"), "'a''b'");
  assert.equal(shellQuote("a'b", "bash"), "'a'\"'\"'b'");
  assert.throws(() => hostShell({ tools: [] } as unknown as ExtensionToolContext), /callable shell/);
});

test("automation fails closed before starting work when configuration escapes repository", async () => {
  let runs = 0;
  const delegates = { run: async () => { runs++; return {}; } } as unknown as Delegates;
  const tool = toolsOf((pi) => registerAutomations(pi, delegates)).get("automation")!;
  const ctx = { cwd: "/tmp/repository" } as ExtensionToolContext;
  await assert.rejects(tool.execute("call", { action: "run", phase: "triage", report: "exact report", configuration: "../outside.yaml" }, undefined, undefined, ctx), /active repository/);
  assert.equal(runs, 0);
});

test("real nested permission hooks see the parent call and can block verify", async () => {
  let nested = false;
  const h = await testSession([(pi) => { pi.on("tool_call", (event) => {
    if (event.toolName === "bash") { nested = Boolean(event.parentToolCallId); return { block: true, reason: "test permission denied" }; }
  }); }]);
  try {
    const result = await h.script('return await tools.verify({command:"printf denied",label:"denied"});');
    assert.equal(result.isError, true);
    assert.equal(nested, true);
    assert.match(result.content.filter((block) => block.type === "text").map((block) => block.text).join(""), /test permission denied/);
    const state = h.session.sessionManager.getBranch().find((entry) => entry.type === "custom" && entry.customType === "codemax-state");
    assert.equal(state, undefined);
  } finally { h.session.dispose(); }
});

test("read-only policy blocks mutating find and ripgrep escape options", () => {
  assert.equal(shellLooksReadOnly("git status --porcelain"), true);
  assert.equal(shellLooksReadOnly("find . -execdir rm {} +"), false);
  assert.equal(shellLooksReadOnly("find . -fprint out"), false);
  assert.equal(shellLooksReadOnly("rg --pre program term"), false);
  assert.equal(shellLooksReadOnly("git branch -D important"), false);
  assert.equal(shellLooksReadOnly("git diff --output stolen"), false);
  assert.equal(referencesBundle("rm -rf " + packageRoot, "/tmp"), true);
  assert.equal(referencesBundle("rm -rf " + bundleRoot, "/tmp"), true);
});
