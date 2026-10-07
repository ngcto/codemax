import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import type { ExtensionAPI, ExtensionContext, ExtensionToolContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Configuration } from "../src/config.ts";
import { WebClients } from "../src/web/client.ts";
import { WebTools } from "../src/web/tools.ts";
import { webProviders } from "../src/web/providers.ts";

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
function mcpFetch(intercept?: (method: string, signal: AbortSignal | null | undefined) => Promise<unknown>): typeof fetch {
  return async (_input, init) => {
    const body = init?.body ? JSON.parse(String(init.body)) as { id?: number; method: string } : undefined;
    if (!body) return new Response(null, { status: 200 });
    const custom = await intercept?.(body.method, init?.signal);
    if (body.id === undefined) return new Response(null, { status: 202 });
    const result = custom ?? (body.method === "initialize" ? { protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1" } }
      : body.method === "tools/list" ? { tools: [{ name: "web_search_exa", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } }] }
      : { content: [{ type: "text", text: "found" }] });
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), { headers: { "content-type": "application/json" } });
  };
}
const anonymous = { modelRegistry: { getProviderAuth: async () => undefined } } as unknown as ExtensionContext;

test("unknown remote capabilities need approval even when their server claims read-only", async () => {
  let toolCalls = 0;
  const clients = new WebClients(mcpFetch(async (method) => {
    if (method === "tools/list") return { tools: [{ name: "custom_operation", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } }] };
    if (method === "tools/call") toolCalls++;
  }));
  const { definitions, ctx } = webHarness(clients);
  try {
    await assert.rejects(definitions.get("web")!.execute("call", { action: "call", provider: "exa", name: "custom_operation", args: {} }, undefined, undefined, ctx), /explicit user approval/);
    assert.equal(toolCalls, 0);
  } finally { await clients.close(); }
});

test("canceling search stops fallback rather than starting the next provider", async () => {
  const entered = deferred<void>(), release = deferred<void>();
  const requests: string[] = [];
  const clients = new WebClients(mcpFetch(async (method) => {
    requests.push(method);
    if (method === "initialize") { entered.resolve(); await release.promise; }
  }));
  const { definitions, ctx } = webHarness(clients);
  ctx.model = undefined;
  const controller = new AbortController();
  const opening = definitions.get("search")!.execute("call", { query: "release notes", provider: "auto" }, controller.signal, undefined, ctx);
  const rejection = assert.rejects(opening, /abort|cancel/i);
  try {
    await entered.promise;
    controller.abort(); await rejection;
    assert.equal(requests.filter((method) => method === "initialize").length, 1);
  } finally { release.resolve(); await clients.close(); }
});

test("canceling one shared connection waiter does not cancel another", async () => {
  const entered = deferred<void>(), release = deferred<void>();
  let initializations = 0;
  const clients = new WebClients(mcpFetch(async (method) => { if (method === "initialize") { initializations++; entered.resolve(); await release.promise; } }));
  const controller = new AbortController();
  const canceled = clients.connect("exa", anonymous, controller.signal);
  const rejection = assert.rejects(canceled, /canceled/i);
  const other = clients.connect("exa", anonymous);
  try {
    await entered.promise;
    controller.abort(); await rejection;
    release.resolve();
    assert.equal((await other).tools[0]?.name, "web_search_exa");
    assert.equal(initializations, 1);
  } finally { release.resolve(); await clients.close(); }
});

test("closing during initialization aborts transport immediately, not after its timeout", async () => {
  const entered = deferred<void>(), release = deferred<void>();
  const clients = new WebClients(mcpFetch(async (method, signal) => {
    if (method === "initialize") {
      entered.resolve();
      await new Promise<void>((resolve, reject) => {
        const abort = () => reject(new Error("fixture connection closed"));
        signal?.addEventListener("abort", abort, { once: true });
        release.promise.then(() => { signal?.removeEventListener("abort", abort); resolve(); });
        if (signal?.aborted) abort();
      });
    }
  }));
  const opening = clients.connect("exa", anonymous);
  const settled = opening.then(() => "connected", () => "closed");
  try {
    await entered.promise;
    const closing = clients.close();
    const winner = await Promise.race([closing.then(() => "closed"), delay(150).then(() => "still waiting")]);
    release.resolve(); await closing;
    assert.equal(winner, "closed");
    assert.equal(await settled, "closed");
  } finally { release.resolve(); await clients.close(); }
});

test("canceling a connection while auth resolves cannot create a late transport", async () => {
  const auth = deferred<undefined>();
  let requests = 0;
  const clients = new WebClients(mcpFetch(async () => { requests++; }));
  const ctx = { modelRegistry: { getProviderAuth: () => auth.promise } } as unknown as ExtensionContext;
  const controller = new AbortController();
  const opening = clients.connect("exa", ctx, controller.signal);
  const outcome = opening.then(() => "connected", () => "canceled");
  try {
    controller.abort();
    const winner = await Promise.race([outcome, delay(150).then(() => "still waiting")]);
    auth.resolve(undefined); await outcome;
    assert.equal(winner, "canceled");
    assert.equal(requests, 0);
  } finally { auth.resolve(undefined); await clients.close(); }
});

function webHarness(clients: WebClients, native = false) {
  const definitions = new Map<string, ToolDefinition>();
  const pi = { registerTool: (tool: ToolDefinition) => definitions.set(tool.name, tool), registerProvider() {}, on() {} } as unknown as ExtensionAPI;
  const config = new Configuration();
  config.session = { web: { enabled: ["exa", "parallel"], native, nativeInConversation: false } };
  const web = new WebTools(pi, config, clients); web.register();
  const ctx = { cwd: "/tmp", isProjectTrusted: () => false, model: { id: "gpt-5.4", provider: "openai", api: "openai-responses", baseUrl: "https://api.openai.com/v1" }, modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true }), getProviderAuth: async () => undefined, streamSimple: () => ({ result: async () => ({ stopReason: "error", errorMessage: "native not enabled for account", content: [] }) }) } } as unknown as ExtensionToolContext;
  return { definitions, ctx };
}

test("all-page fetch failure preserves provider diagnostics instead of hiding keyless rejection", async () => {
  const clients = new WebClients(mcpFetch(async (method) => method === "tools/list" ? { tools: [{ name: "crawling_exa", inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } }] }
    : method === "tools/call" ? { isError: true, content: [{ type: "text", text: "Anonymous keyless access is unavailable for this request." }] } : undefined));
  const { definitions, ctx } = webHarness(clients);
  try {
    await assert.rejects(definitions.get("fetch")!.execute("call", { urls: ["https://example.com"], provider: "exa" }, undefined, undefined, ctx), /Anonymous keyless access is unavailable.*\n.*\/login exa/);
  } finally { await clients.close(); }
});

test("hosted search and fetch fall back from Exa directly to Parallel with diagnostics", async () => {
  const calls: { provider: string; name: string }[] = [];
  const clients = new WebClients(async (input, init) => {
    const provider = String(input) === webProviders.exa.anonymousUrl ? "exa" : "parallel";
    assert.equal(String(input), webProviders[provider].anonymousUrl);
    const request = init?.body ? JSON.parse(String(init.body)) : undefined;
    const search = provider === "exa"
      ? { name: "web_search_exa", inputSchema: { type: "object", properties: { query: { type: "string" }, objective: { type: "string" } }, required: ["query"] } }
      : { name: "web_search", inputSchema: { type: "object", properties: { objective: { type: "string" }, search_queries: { type: "array", items: { type: "string" } } }, required: ["objective", "search_queries"] } };
    const fetch = { name: provider === "exa" ? "web_fetch_exa" : "web_fetch", inputSchema: { type: "object", properties: { urls: { type: "array", items: { type: "string" } } }, required: ["urls"] } };
    return mcpFetch(async (method) => {
      if (method === "tools/list") return { tools: [search, fetch] };
      if (method === "tools/call") {
        calls.push({ provider, name: request.params.name });
        return { ...(provider === "exa" ? { isError: true } : {}), content: [{ type: "text", text: provider === "exa" ? "fixture Exa unavailable" : "parallel proof" }] };
      }
    })(input, init);
  });
  const { definitions, ctx } = webHarness(clients);
  try {
    for (const [name, input] of [["search", { query: "release notes", provider: "auto" }], ["fetch", { urls: ["https://example.com"], provider: "auto" }]] as const) {
      const result = await definitions.get(name)!.execute("call", input, undefined, undefined, ctx);
      const value = result.structuredContent as { provider: string; failures: { provider: string; error: string }[] };
      assert.equal(value.provider, "parallel");
      assert.equal(value.failures.length, 1);
      assert.equal(value.failures[0]?.provider, "exa");
      assert.match(value.failures[0]?.error ?? "", /fixture Exa unavailable/);
    }
    assert.deepEqual(calls, [{ provider: "exa", name: "web_search_exa" }, { provider: "parallel", name: "web_search" }, { provider: "exa", name: "web_fetch_exa" }, { provider: "parallel", name: "web_fetch" }]);
  } finally { await clients.close(); }
});

test("auto native-search failure falls back explicitly, while explicit native preserves failure", async () => {
  const clients = new WebClients(mcpFetch());
  const { definitions, ctx } = webHarness(clients, true);
  try {
    const result = await definitions.get("search")!.execute("call", { query: "release notes", provider: "auto" }, undefined, undefined, ctx);
    const value = result.structuredContent as { provider: string; failures: { provider: string; error: string }[] };
    assert.equal(value.provider, "exa");
    assert.equal(value.failures[0]?.provider, "native");
    assert.match(value.failures[0]?.error ?? "", /native not enabled/);
    await assert.rejects(definitions.get("search")!.execute("call", { query: "release notes", provider: "native" }, undefined, undefined, ctx), /native not enabled/);
  } finally { await clients.close(); }
});
