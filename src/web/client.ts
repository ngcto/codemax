import { createHash } from "node:crypto";
import { McpClient, StreamableHttpTransport, type Tool } from "@earendil-works/pi-mcp";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { WebProviderId } from "../config.ts";
import { webProviders, type WebProviderSpec } from "./providers.ts";
import { Type } from "typebox";
import { Value } from "typebox/value";

interface Connection { client: McpClient; tools: Tool[]; }
interface ClientEntry { client: McpClient; promise: Promise<Connection>; }
function waitFor<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", abort);
    const abort = () => { cleanup(); reject(new Error("Web connection canceled.")); };
    signal.addEventListener("abort", abort, { once: true });
    promise.then((value) => { cleanup(); resolve(value); }, (error) => { cleanup(); reject(error); });
    if (signal.aborted) abort();
  });
}
export class WebClients {
  private clients = new Map<string, ClientEntry>();
  private lifecycle = new AbortController();
  private closing = new Set<Promise<void>>();
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}
  async connect(id: WebProviderId, ctx: ExtensionContext, signal?: AbortSignal): Promise<Connection> {
    const lifecycle = this.lifecycle.signal;
    const waiting = signal ? AbortSignal.any([lifecycle, signal]) : lifecycle;
    waiting.throwIfAborted();
    const spec = webProviders[id];
    const auth = await waitFor(ctx.modelRegistry.getProviderAuth(id), waiting);
    waiting.throwIfAborted();
    const oauth = auth?.auth.baseUrl === spec.oauthUrl;
    const key = auth?.auth.apiKey;
    const url = oauth ? spec.oauthUrl : spec.anonymousUrl;
    const fingerprint = id + ":" + createHash("sha256").update(url + "\0" + (key ?? "")).digest("hex");
    let entry = this.clients.get(fingerprint);
    if (!entry) {
      const client = new McpClient({ name: "codemax", version: "0.1.0", requestTimeoutMs: 60000 });
      entry = { client, promise: this.open(client, spec, url, key, oauth, lifecycle) };
      this.clients.set(fingerprint, entry);
      const current = entry;
      const forget = () => { if (this.clients.get(fingerprint) === current) this.clients.delete(fingerprint); };
      client.onClose(forget);
      void entry.promise.catch(forget);
      for (const [other, previous] of this.clients) if (other.startsWith(id + ":") && other !== fingerprint) {
        this.clients.delete(other);
        void this.retire(previous.client);
      }
    }
    // Cancel this waiter, not the transport another script may also be awaiting.
    return waitFor(entry.promise, waiting);
  }
  private async open(client: McpClient, spec: WebProviderSpec, url: string, key: string | undefined, oauth: boolean, lifecycle: AbortSignal): Promise<Connection> {
    const headers: Record<string, string> = {};
    if (key) headers[oauth ? "Authorization" : spec.keyHeader] = oauth || spec.keyHeader === "Authorization" ? "Bearer " + key : key;
    const boundedFetch: typeof fetch = (input, init) => this.fetchImpl(input, { ...init, signal: AbortSignal.any([lifecycle, AbortSignal.timeout(60000), ...(init?.signal ? [init.signal] : [])]) });
    try {
      await client.connect(new StreamableHttpTransport({ url, headers, fetch: boundedFetch, openGetStream: false }));
      return { client, tools: await client.listTools({ signal: lifecycle }) };
    } catch (error) {
      await this.retire(client);
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(spec.name + " is unavailable: " + reason + ". Retry later or run /login " + spec.id + ".", { cause: error });
    }
  }
  async call(id: WebProviderId, name: string, args: Record<string, unknown>, ctx: ExtensionContext, signal?: AbortSignal) {
    const connection = await this.connect(id, ctx, signal);
    signal?.throwIfAborted();
    const tool = connection.tools.find((tool) => tool.name === name);
    if (!tool) throw new Error("Unknown " + id + " tool " + name + ". Discover its live schema with web(action=tools).");
    if (!Value.Check(Type.Unsafe(tool.inputSchema), args)) throw new Error("Arguments no longer match " + id + "/" + name + ". Inspect the live schema with web(action=tools) and adapt a custom capability.");
    const result = await connection.client.callTool(name, args, { signal });
    if (result.isError) throw new Error(result.content.filter((x) => x.type === "text").map((x) => x.text).join("\n") + "\nAccount-backed access: /login " + id + ". Provider quotas and anonymous availability still apply.");
    return result;
  }
  private retire(client: McpClient): Promise<void> {
    const closing = client.close().catch(() => {});
    this.closing.add(closing);
    void closing.then(() => this.closing.delete(closing));
    return closing;
  }
  async close(): Promise<void> {
    const entries = [...this.clients.values()];
    this.clients.clear();
    const lifecycle = this.lifecycle;
    this.lifecycle = new AbortController();
    lifecycle.abort();
    await Promise.allSettled([...entries.map((entry) => this.retire(entry.client)), ...this.closing, ...entries.map((entry) => entry.promise)]);
  }
}

export function buildSearchArgs(spec: WebProviderSpec, tool: Tool, input: { query: string; objective?: string; limit?: number }): Record<string, unknown> {
  const properties = (tool.inputSchema.properties ?? {}) as Record<string, unknown>;
  const limit = input.limit ?? 8;
  const candidates: Record<string, unknown> = spec.id === "exa"
    ? { query: input.query, objective: input.objective ?? input.query, numResults: limit, type: "auto" }
    : spec.id === "firecrawl"
      ? { query: input.query, objective: input.objective ?? input.query, limit, scrapeOptions: { formats: ["markdown"] } }
      : { objective: input.objective ?? input.query, query: input.query, search_queries: [input.query], searchQueries: [input.query], max_results: limit, maxResults: limit, mode: "basic" };
  return Object.fromEntries(Object.entries(candidates).filter(([name]) => name in properties));
}
export function buildFetchArgs(spec: WebProviderSpec, tool: Tool, urls: string[], maxCharacters: number): Record<string, unknown> {
  const properties = (tool.inputSchema.properties ?? {}) as Record<string, unknown>;
  const candidates: Record<string, unknown> = spec.id === "exa"
    ? { urls, url: urls[0], maxCharacters, maxCharactersPerUrl: maxCharacters }
    : spec.id === "firecrawl"
      ? { url: urls[0], formats: ["markdown"], onlyMainContent: true }
      : { urls, url: urls[0], maxCharacters, max_characters: maxCharacters, full_content: true, objective: "Read the requested pages and preserve their relevant content.", advanced_settings: { full_content: true } };
  return Object.fromEntries(Object.entries(candidates).filter(([name]) => name in properties));
}
