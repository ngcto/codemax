import assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { ExtensionAPI, ExtensionToolContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import { Delegates, DelegateOutput, Limiter, resolveModel } from "../src/delegates.ts";
import { Configuration } from "../src/config.ts";
import { runProcess, runShell } from "../src/process.ts";

const fixture = fileURLToPath(new URL("./fixtures/fake-pi.mjs", import.meta.url));
const base = { id: "gpt-test", name: "Test", provider: "faux", api: "openai-responses", reasoning: true, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: null, max: null } } as Model<string>;
const second = { ...base, id: "claude-test" };
const third = { ...base, id: "grok-test" };

async function harness() {
  const cwd = await mkdtemp(join(tmpdir(), "codemax-delegate-test-"));
  const config = new Configuration();
  config.session = { maxDelegates: 2, budget: "unlimited", roles: { "arena runners": ["faux/gpt-test", "faux/claude-test"], "arena cross-judge pool": ["faux/grok-test"] } };
  const tools = new Map<string, ToolDefinition>();
  const pi = { registerTool: (tool: ToolDefinition) => tools.set(tool.name, tool) } as unknown as ExtensionAPI;
  const ctx = { cwd, tools: [{ name: "bash" }], model: base, isProjectTrusted: () => true, modelRegistry: { getAvailable: () => [base, second, third] }, async executeTool(name: string, input: { command: string; timeout?: number }, options?: { signal?: AbortSignal }) {
    assert.equal(name, "bash");
    const r = await runShell(input.command, { cwd, signal: options?.signal, timeoutMs: (input.timeout ?? 30) * 1000 });
    return { isError: r.exitCode !== 0, result: { content: [{ type: "text", text: r.stdout + r.stderr }], details: {}, structuredContent: { output: r.stdout + r.stderr, exit_code: r.exitCode } } };
  } } as unknown as ExtensionToolContext;
  const delegates = new Delegates(pi, config);
  delegates.register();
  return { cwd, ctx, delegates, tools };
}

function withEnv(values: Record<string, string>): () => void {
  const original = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  return () => { for (const [key, value] of Object.entries(original)) if (value === undefined) delete process.env[key]; else process.env[key] = value; };
}

test("delegates select verified models, inherit aliases, and reject unavailable ids", () => {
  assert.equal(resolveModel("auto", [base], base), base);
  assert.equal(resolveModel("inherit-parent", [base], base), base);
  assert.equal(resolveModel("faux/gpt-test", [base], second), base);
  assert.throws(() => resolveModel("invented", [base], base), /Model unavailable/);
  assert.throws(() => resolveModel(base.id, [base, { ...base, provider: "other" }], base), /Ambiguous model/);
});

test("fresh delegate process receives scoped policy, supported effort and no Slack env secrets", async () => {
  const restore = withEnv({ CODEMAX_PI_BINARY: fixture, BENNY_SLACK_BOT_TOKEN: "test-secret" });
  try {
    const h = await harness();
    const result = await h.delegates.run({ task: "inspect", agent: "comment-sicko" }, h.ctx);
    assert.equal(result.status, "complete");
    assert.equal(result.usage.totalTokens, 5);
    const message = JSON.parse(result.output) as { args: string[]; commentProfile: boolean; hasSlackSecret: boolean; nested: string; cwd: string; readonly: string };
    assert.ok(message.args.includes("--no-extensions"));
    assert.ok(message.args.includes("builtin:mcp"));
    assert.equal(message.args[message.args.indexOf("--thinking") + 1], "high");
    assert.equal(message.commentProfile, true);
    assert.equal(message.hasSlackSecret, false);
    assert.equal(message.nested, "0");
    assert.equal(message.readonly, "1");
    assert.equal(message.cwd, h.cwd);
    assert.match(await readFile(result.transcript, "utf8"), /message_end/);
    const failed = await h.delegates.run({ task: "FAIL" }, h.ctx);
    assert.equal(failed.status, "failed");
    const timeout = await h.delegates.run({ task: "WAIT", timeout: 0.1 }, h.ctx);
    assert.equal(timeout.status, "timeout");
  } finally { restore(); }
});

test("writable delegate requires a clean isolated baseline and leaves the parent untouched", async () => {
  const restore = withEnv({ CODEMAX_PI_BINARY: fixture });
  try {
    const h = await harness();
    await assert.rejects(h.delegates.run({ task: "write", readOnly: false }, h.ctx), /isolate=true/);
    await runProcess("git", ["init", "-q", h.cwd], { cwd: h.cwd });
    await writeFile(join(h.cwd, "baseline.txt"), "parent");
    await runProcess("git", ["add", "."], { cwd: h.cwd });
    await runProcess("git", ["-c", "user.name=Codemax Test", "-c", "user.email=codemax@example.test", "commit", "-qm", "baseline"], { cwd: h.cwd });
    const result = await h.delegates.run({ task: "candidate", readOnly: false, isolate: true, agent: "ultracode-agent" }, h.ctx);
    assert.equal(result.status, "complete");
    assert.ok(result.worktree && result.worktree !== h.cwd);
    const message = JSON.parse(result.output) as { cwd: string; ultracodeProfile: boolean; readonly: string };
    assert.equal(message.cwd, result.worktree);
    assert.equal(message.ultracodeProfile, true);
    assert.equal(message.readonly, "0");
    assert.equal(await readFile(join(result.worktree, "baseline.txt"), "utf8"), "parent");
    assert.equal(await readFile(join(h.cwd, "baseline.txt"), "utf8"), "parent");
    await writeFile(join(h.cwd, "uncommitted.txt"), "dirty");
    await assert.rejects(h.delegates.run({ task: "candidate", readOnly: false, isolate: true }, h.ctx), /Commit the candidate baseline/);
  } finally { restore(); }
});

test("panel honors each configured role seat, waits before judging and validates rubric before spawning", async () => {
  const restore = withEnv({ CODEMAX_PI_BINARY: fixture });
  try {
    const h = await harness();
    const tool = h.tools.get("panel")!;
    await assert.rejects(tool.execute("call", { mode: "arena", tasks: [{ task: "candidate" }], judge: true }, undefined, undefined, h.ctx), /rubric/);
    const r = await tool.execute("call", { mode: "arena", tasks: [{ task: "A" }, { task: "B" }], rubric: "literal correctness", judge: true }, undefined, undefined, h.ctx);
    const value = r.structuredContent as { results: { model: string; status: string }[]; judge: { model: string }; crossModelReview: boolean; independentReview: boolean };
    assert.deepEqual(value.results.map((item) => item.model), ["faux/gpt-test", "faux/claude-test"]);
    assert.equal(value.judge.model, "faux/grok-test");
    assert.equal(value.crossModelReview, true);
    assert.equal(value.independentReview, true);
    assert.ok(value.results.every((item) => item.status === "complete"));
    assert.equal(r.usage?.totalTokens, 15);
  } finally { restore(); }
});

test("unconfigured judge inherits the parent and read-only workers cannot delegate writes", async () => {
  const restore = withEnv({ CODEMAX_PI_BINARY: fixture });
  try {
    const h = await harness();
    const config = new Configuration();
    config.session = { roles: { "arena runners": ["faux/gpt-test"] } };
    const pi = { registerTool: (tool: ToolDefinition) => h.tools.set(tool.name, tool) } as unknown as ExtensionAPI;
    new Delegates(pi, config).register();
    const result = await h.tools.get("panel")!.execute("call", { mode: "arena", tasks: [{ task: "candidate" }], rubric: "literal correctness", judge: true }, undefined, undefined, h.ctx);
    const value = result.structuredContent as { judge: { model: string }; crossModelReview: boolean };
    assert.equal(value.judge.model, "faux/gpt-test");
    assert.equal(value.crossModelReview, false);
    const reset = withEnv({ CODEMAX_READONLY: "1", CODEMAX_ALLOW_DELEGATION: "1" });
    try { await assert.rejects(h.delegates.run({ task: "write", readOnly: false, isolate: true }, h.ctx), /cannot grant writes/); }
    finally { reset(); }
  } finally { restore(); }
});

test("delegate limiter removes canceled waiters without consuming the next slot", async () => {
  const limiter = new Limiter();
  let release!: () => void;
  const first = limiter.run(1, undefined, () => new Promise<void>((resolve) => { release = resolve; }));
  const controller = new AbortController();
  const queued = limiter.run(1, controller.signal, async () => "not reached");
  const rejection = assert.rejects(queued, /canceled/);
  controller.abort();
  await rejection;
  release(); await first;
  assert.equal(await limiter.run(1, undefined, async () => "next"), "next");
});

test("delegate JSONL parsing keeps Unicode separators and ignores non-final events", () => {
  const output = new DelegateOutput();
  const line = JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "before\u2028after" }], stopReason: "stop" } });
  output.consume(line.slice(0, 30)); output.consume(line.slice(30) + "\n"); output.finish();
  assert.equal(output.text, "before\u2028after");
  assert.equal(output.stopReason, "stop");
});

test("delegate accounting includes nested tool-result usage without changing final output", () => {
  const output = new DelegateOutput();
  const usage = { input: 2, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 5, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
  output.consume(JSON.stringify({ type: "message_end", message: { role: "toolResult", content: [{ type: "text", text: "not the final answer" }], usage } }) + "\n");
  output.consume(JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "final answer" }], stopReason: "stop", usage } }) + "\n");
  output.finish();
  assert.equal(output.text, "final answer");
  assert.equal(output.usage.totalTokens, 10);
});
