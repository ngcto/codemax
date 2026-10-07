import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Configuration } from "../src/config.ts";
import { WebClients, buildSearchArgs, buildFetchArgs } from "../src/web/client.ts";
import { WebTools } from "../src/web/tools.ts";
import { nativeFamily, addNativeTools, nativeToolSpecs } from "../src/web/native.ts";
import { manualCallback, webAuthProvider } from "../src/web/oauth.ts";
import { webProviders } from "../src/web/providers.ts";
import { testSession } from "./harness.ts";

const gpt = { id: "gpt-5.4", provider: "openai", api: "openai-responses" };
const grok = { id: "grok-4.1", provider: "xai", api: "openai-responses" };

test("native tools are family and wire-protocol constrained, additive and idempotent", () => {
  assert.equal(nativeFamily(gpt), "gpt");
  assert.equal(nativeFamily(grok), "grok");
  assert.equal(nativeFamily({ ...gpt, provider: "openrouter" }), undefined);
  assert.equal(nativeFamily({ ...grok, api: "openai-completions" }), undefined);
  assert.equal(nativeFamily({ ...gpt, id: "o3" }), undefined);
  assert.equal(nativeFamily({ ...gpt, baseUrl: "https://api.openai.com/v1" }), "gpt");
  assert.equal(nativeFamily({ ...gpt, baseUrl: "https://proxy.example/v1" }), undefined);
  assert.equal(nativeFamily({ ...gpt, provider: "openai-codex" }), undefined);
  assert.equal(nativeFamily({ ...gpt, provider: "openai-codex", api: "openai-codex-responses", baseUrl: "https://chatgpt.com/backend-api" }), "gpt");
  assert.equal(nativeFamily({ ...grok, api: "azure-openai-responses" }), undefined);
  assert.deepEqual(nativeToolSpecs("grok"), [{ type: "web_search" }, { type: "x_search" }]);
  const payload = { model: gpt.id, tools: [{ type: "function", name: "codemode" }] };
  const updated = addNativeTools(payload, gpt) as { tools: unknown[] };
  assert.deepEqual(updated.tools, [{ type: "function", name: "codemode" }, { type: "web_search" }]);
  assert.equal(addNativeTools(updated, gpt), undefined);
  assert.equal(addNativeTools({ model: "other", tools: [] }, gpt), undefined);
  const azure = { ...gpt, provider: "azure", api: "azure-openai-responses", baseUrl: "https://fixture.openai.azure.com/openai/v1" };
  assert.deepEqual((addNativeTools({ model: "deployment-alias", tools: [] }, azure) as { tools: unknown[] }).tools, [{ type: "web_search" }]);
  assert.equal(addNativeTools(payload, { ...gpt, provider: "anthropic" }), undefined);
});

test("provider login registrations have no fake chat models and enforce OAuth state", () => {
  for (const spec of Object.values(webProviders)) {
    const provider = webAuthProvider(spec);
    assert.equal(provider.id, spec.id);
    assert.equal(provider.name, spec.name);
    assert.equal(provider.auth.oauth?.name, spec.name + " OAuth");
    assert.equal(provider.auth.apiKey?.name, spec.name + " API key");
    assert.deepEqual(provider.getModels(), []);
    assert.ok(provider.auth.oauth);
    assert.notEqual(spec.anonymousUrl, spec.oauthUrl);
  }
  assert.deepEqual(manualCallback("http://127.0.0.1/callback?code=abc&state=ok", "ok"), { code: "abc", state: "ok" });
  assert.throws(() => manualCallback("http://127.0.0.1/callback?code=abc&state=wrong", "ok"), /state mismatch/);
  assert.throws(() => manualCallback("http://127.0.0.1/callback?state=ok&error=denied", "ok"), /denied/);
  assert.throws(() => manualCallback("http://127.0.0.1/callback?state=ok", "ok"), /no authorization code/);
});

test("MCP clients use anonymous, API-key, and OAuth endpoints without prefixing tools", async () => {
  const calls: { url: string; headers: Headers; method: string; params?: Record<string, unknown> }[] = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) as { id?: number; method: string; params?: Record<string, unknown> } : undefined;
    if (!body) return new Response(null, { status: 200 });
    calls.push({ url, headers: new Headers(init?.headers), method: body.method, params: body.params });
    if (body.id === undefined) return new Response(null, { status: 202 });
    const result = body.method === "initialize" ? { protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "fake", version: "1" } }
      : body.method === "tools/list" ? { tools: [{ name: "web_search_exa", description: "Search", inputSchema: { type: "object", properties: { query: { type: "string" }, objective: { type: "string" }, numResults: { type: "number" } }, required: ["query"] } }] }
      : { content: [{ type: "text", text: "found" }] };
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), { headers: { "content-type": "application/json" } });
  };
  let auth: { auth: { apiKey?: string; baseUrl?: string } } | undefined;
  const ctx = { modelRegistry: { getProviderAuth: async () => auth } } as unknown as ExtensionContext;
  const clients = new WebClients(fakeFetch);
  try {
    assert.equal((await clients.connect("exa", ctx)).tools[0]?.name, "web_search_exa");
    assert.equal(calls[0]?.url, webProviders.exa.anonymousUrl);
    assert.equal(calls[0]?.headers.get("authorization"), null);
    auth = { auth: { apiKey: "api-test" } };
    await clients.call("exa", "web_search_exa", { query: "test" }, ctx);
    assert.ok(calls.some((call) => call.headers.get("authorization") === "Bearer api-test"));
    auth = { auth: { apiKey: "oauth-test", baseUrl: webProviders.exa.oauthUrl } };
    await clients.connect("exa", ctx);
    assert.ok(calls.some((call) => call.url === webProviders.exa.oauthUrl && call.headers.get("authorization") === "Bearer oauth-test"));
    assert.ok(calls.every((call) => !call.url.includes("api-test") && !call.url.includes("oauth-test")));
  } finally { await clients.close(); }
});

test("provider adapters use advertised schemas, including Firecrawl single-page fetch", () => {
  const exa = { name: "web_search_exa", inputSchema: { properties: { query: {}, objective: {}, numResults: {} } } };
  assert.deepEqual(buildSearchArgs(webProviders.exa, exa, { query: "Q", limit: 3 }), { query: "Q", objective: "Q", numResults: 3 });
  const parallel = { name: "web_search", inputSchema: { properties: { objective: {}, search_queries: {}, max_results: {} } } };
  assert.deepEqual(buildSearchArgs(webProviders.parallel, parallel, { query: "Q" }), { objective: "Q", search_queries: ["Q"], max_results: 8 });
  const fire = { name: "firecrawl_scrape", inputSchema: { properties: { url: {}, formats: {}, onlyMainContent: {} } } };
  assert.deepEqual(buildFetchArgs(webProviders.firecrawl, fire, ["https://example.com"], 500), { url: "https://example.com", formats: ["markdown"], onlyMainContent: true });
});

test("GPT replaces script search, Grok restores it and adds X, other models remove native-only X", async () => {
  const tools = new Map<string, ToolDefinition>();
  const api = { registerTool: (tool: ToolDefinition) => tools.set(tool.name, tool), registerProvider() {}, on() {} } as unknown as ExtensionAPI;
  const config = new Configuration();
  config.session = { web: { native: true, nativeInConversation: true } };
  const web = new WebTools(api, config);
  web.register();
  let effectiveUrl: string | undefined;
  const ctx = { cwd: "/tmp", isProjectTrusted: () => false, modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true, baseUrl: effectiveUrl }) }, model: gpt } as unknown as ExtensionContext;
  await web.update(ctx);
  assert.equal(tools.get("search")?.exposure, "hidden");
  assert.equal(tools.get("fetch")?.exposure, "codemode");
  assert.equal(tools.get("x_search")?.exposure, "hidden");
  effectiveUrl = "https://unverified-proxy.example/v1";
  await web.update(ctx);
  assert.equal(tools.get("search")?.exposure, "codemode");
  effectiveUrl = undefined;
  ctx.model = grok as never;
  await web.update(ctx);
  assert.equal(tools.get("search")?.exposure, "codemode");
  assert.equal(tools.get("x_search")?.exposure, "codemode");
  ctx.model = { ...gpt, provider: "anthropic" } as never;
  await web.update(ctx);
  assert.equal(tools.get("search")?.exposure, "codemode");
  assert.equal(tools.get("x_search")?.exposure, "hidden");
  config.session.web!.nativeInConversation = false;
  ctx.model = gpt as never;
  await web.update(ctx);
  assert.equal(tools.get("search")?.exposure, "codemode");
});

test("real Pi exposes short web-provider login labels before and after reload", async () => {
  const h = await testSession();
  try {
    const check = () => {
      for (const [id, name] of [["exa", "Exa"], ["firecrawl", "Firecrawl"], ["parallel", "Parallel"]] as const) {
        const provider = h.runtime.getProvider(id);
        assert.equal(provider?.name, name);
        assert.equal(provider?.auth.oauth?.name, name + " OAuth");
        assert.equal(h.runtime.getModels(id).length, 0);
      }
      assert.deepEqual(h.runtimeErrors, []);
    };
    check();
    await h.session.reload();
    check();
  } finally { h.session.dispose(); }
});
