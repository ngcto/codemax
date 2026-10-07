import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { binding } from "../src/catalog.ts";
import { Delegates } from "../src/delegates.ts";
import { Configuration } from "../src/config.ts";
import { packageRoot } from "../src/paths.ts";
import { runProcess, shellQuote } from "../src/process.ts";

type Request = { tools?: { function?: { name?: string; description?: string } }[]; messages?: { role: string; content?: string | { type: string; text?: string }[] }[] };
interface CliFixture { cwd: string; agentDir: string; cli: string; binary: string; model: Model<string>; requests: Request[]; }

// A local protocol fixture, not a live model account. Children run the real Pi CLI.
async function withCliFixture(run: (fixture: CliFixture) => Promise<void>) {
  const cwd = await mkdtemp(join(tmpdir(), "codemax-real-cli-"));
  const requests: Request[] = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push(JSON.parse(body));
    res.writeHead(200, { "content-type": "text/event-stream" });
    const first = requests.length === 1;
    const delta = first ? { role: "assistant", tool_calls: [{ index: 0, id: "call_cli", type: "function", function: { name: "codemode", arguments: JSON.stringify({ code: 'return await tools.verify({command:"pwd",label:"real CLI nested proof"});' }) } }] } : { role: "assistant", content: "real-cli-ok" };
    const chunk = (value: unknown) => res.write("data: " + JSON.stringify(value) + "\n\n");
    chunk({ id: "local-test", object: "chat.completion.chunk", created: 1, model: "local-test", choices: [{ index: 0, delta, finish_reason: null }] });
    chunk({ id: "local-test", object: "chat.completion.chunk", created: 1, model: "local-test", choices: [{ index: 0, delta: {}, finish_reason: first ? "tool_calls" : "stop" }], usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 } });
    res.end("data: [DONE]\n\n");
  });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = "http://127.0.0.1:" + address.port + "/v1";
    const agentDir = join(cwd, "agent");
    await mkdir(agentDir);
    await writeFile(join(agentDir, "models.json"), JSON.stringify({ providers: { "local-fixture": { baseUrl, api: "openai-completions", apiKey: "fixture", models: [{ id: "local-test", name: "Local fixture", reasoning: false, input: ["text"], contextWindow: 200000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }));
    const cli = join(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")), "../bundle/cli.js");
    const binary = join(cwd, "pi-fixture");
    await writeFile(binary, "#!/usr/bin/env bash\nexec " + shellQuote(process.execPath) + " " + shellQuote(cli) + ' --offline "$@"\n', { mode: 0o700 });
    const model = { id: "local-test", provider: "local-fixture", api: "openai-completions", reasoning: false } as Model<string>;
    await run({ cwd, agentDir, cli, binary, model, requests });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function requestText(request: Request, role: string): string {
  return (request.messages ?? []).filter((message) => message.role === role).map((message) => typeof message.content === "string" ? message.content : message.content?.map((block) => block.text ?? "").join("\n") ?? "").join("\n");
}

function assertNestedProof(requests: Request[]) {
  assert.equal(requests.length, 2);
  for (const request of requests) assert.deepEqual(request.tools?.map((tool) => tool.function?.name), ["codemode"]);
  assert.ok(requests[1]?.messages?.some((message) => message.role === "tool"));
}

test("real Pi JSON-mode delegate loads fallback codemode and executes nested verification", { skip: process.platform === "win32", timeout: 30000 }, async () => {
  await withCliFixture(async ({ cwd, agentDir, binary, model, requests }) => {
    const values = { CODEMAX_PI_BINARY: binary, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1" };
    const original = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
    Object.assign(process.env, values);
    try {
      const ctx = { cwd, tools: [{ name: "bash" }], model, isProjectTrusted: () => true, modelRegistry: { getAvailable: () => [model] } } as unknown as ExtensionToolContext;
      const delegates = new Delegates({} as ExtensionAPI, new Configuration());
      const result = await delegates.run({ task: "Run the exact local proof, then say real-cli-ok", skill: "deslop", readOnly: true, timeout: 20 }, ctx);
      assert.equal(result.status, "complete", result.output + "\n" + result.stderr);
      assert.equal(result.output, "real-cli-ok");
      assertNestedProof(requests);
      const system = requestText(requests[0]!, "system");
      assert.equal(system.split(binding).length - 1, 1, "shared rules appear once in delegate prompts");
      assert.ok(system.includes("Read-only investigation. Do not change files or external state."));
      assert.ok(system.includes("Nested delegation is forbidden."));
      assert.ok(system.includes("# Remove AI code slop"));
      assert.ok(!system.includes("## Pi execution contract"));
      assert.match(await readFile(result.transcript, "utf8"), /real CLI nested proof/);
      assert.ok(result.usage.totalTokens >= 8);
    } finally {
      for (const [key, value] of Object.entries(original)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
});

test("real Pi CLI expands a native skill command and starts warning-free with only codemode", { skip: process.platform === "win32", timeout: 30000 }, async () => {
  await withCliFixture(async ({ cwd, agentDir, cli, requests }) => {
    await writeFile(join(agentDir, "settings.json"), JSON.stringify({ defaultTools: ["+codemode", "+tool_search"], codemode: { mode: "on" } }));
    const result = await runProcess(process.execPath, [cli, "--offline", "--mode", "json", "--print", "--no-session", "--no-skills", "--no-context-files", "--no-approve", "--extension", join(packageRoot, "src", "index.ts"), "--model", "local-fixture/local-test", "/skill:ultracode Run the exact local proof, then say real-cli-ok"], { cwd, env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1" }, timeoutMs: 20000 });
    assert.equal(result.exitCode, 0, result.stdout + "\n" + result.stderr);
    assert.equal(result.stderr.trim(), "", "no extension replacement warning or initialization error");
    assert.match(result.stdout, /real-cli-ok/);
    assert.match(result.stdout, /real CLI nested proof/);
    assertNestedProof(requests);
    assert.match(requests[0]?.tools?.[0]?.function?.description ?? "", /### `read`/);
    const prompt = requestText(requests[0]!, "user");
    assert.ok(prompt.includes('<skill name="ultracode" location="'));
    assert.ok(!prompt.includes("## Pi execution contract"));
    const path = join(packageRoot, "resources/skills/ultracode/SKILL.md");
    const body = (await readFile(path, "utf8")).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/u, "").trim();
    assert.equal(prompt, `<skill name="ultracode" location="${path}">\nReferences are relative to ${dirname(path)}.\n\n${body}\n</skill>\n\nRun the exact local proof, then say real-cli-ok`);
    assert.ok(prompt.endsWith("</skill>\n\nRun the exact local proof, then say real-cli-ok"));
    const saved = JSON.parse(await readFile(join(agentDir, "settings.json"), "utf8"));
    assert.equal(saved.codemode.mode, "on");
  });
});
