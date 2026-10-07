import type { OAuthCredential, Provider, ProviderAuthInteraction } from "@earendil-works/pi-ai";
import { authorizeMcp, McpOAuthProvider, OAuthCallbackServer, type McpOAuthState } from "@earendil-works/pi-mcp/oauth";
import type { WebProviderSpec } from "./providers.ts";

export interface OAuthStore { state?: McpOAuthState; }
function provider(spec: WebProviderSpec, redirectUrl: string, store: OAuthStore, onRedirect: (url: URL) => void): McpOAuthProvider {
  return new McpOAuthProvider({ serverUrl: spec.oauthUrl, redirectUrl, clientMetadata: { client_name: "codemax " + spec.name, grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" }, store: { load: () => store.state, save: (state) => { store.state = state; } }, onRedirect });
}
export function manualCallback(value: string, expected: string): { code: string; state: string; iss?: string } {
  const url = new URL(value.trim());
  if (url.searchParams.get("state") !== expected) throw new Error("OAuth state mismatch. Paste the full callback URL from this login.");
  const error = url.searchParams.get("error");
  if (error) throw new Error("OAuth authorization was denied.");
  const code = url.searchParams.get("code");
  if (!code) throw new Error("The callback URL has no authorization code.");
  return { code, state: expected, ...(url.searchParams.get("iss") ? { iss: url.searchParams.get("iss")! } : {}) };
}
function oauthFetch(signal: AbortSignal): typeof fetch {
  return (input, init) => fetch(input, { ...init, signal: AbortSignal.any([signal, AbortSignal.timeout(60000), ...(init?.signal ? [init.signal] : [])]) });
}
function credentials(store: OAuthStore, redirectUrl: string): OAuthCredential {
  const tokens = store.state?.tokens;
  if (!tokens?.access_token) throw new Error("The provider did not return an access token.");
  return { type: "oauth", access: tokens.access_token, refresh: tokens.refresh_token ?? "", expires: store.state?.tokensExpireAt ?? Date.now() + 3600000, mcp: store.state, redirectUrl };
}

export async function loginWebProvider(spec: WebProviderSpec, interaction: ProviderAuthInteraction): Promise<OAuthCredential> {
  interaction.signal.throwIfAborted();
  const callback = await OAuthCallbackServer.listen({ timeoutMs: 300000 });
  const store: OAuthStore = {};
  const manual = new AbortController();
  let abortListener: (() => void) | undefined;
  const auth = provider(spec, callback.redirectUrl, store, (url) => interaction.notify({ type: "auth_url", url: url.href, instructions: "Sign in and approve your team. codemax will reuse these credentials for higher limits." }));
  try {
    const result = await authorizeMcp(auth, { serverUrl: spec.oauthUrl, skipRefresh: true, fetch: oauthFetch(interaction.signal) });
    if (result === "REDIRECT") {
      const expected = await auth.state();
      const wait = callback.waitForCallback(expected);
      const paste = interaction.prompt({ type: "manual_code", message: "Finish browser sign-in, or paste the full redirect URL if the callback cannot reach Pi.", signal: AbortSignal.any([interaction.signal, manual.signal]) }).then((value) => manualCallback(value, expected));
      const aborted = new Promise<never>((_resolve, reject) => {
        abortListener = () => reject(new Error("OAuth login canceled."));
        interaction.signal.addEventListener("abort", abortListener, { once: true });
        if (interaction.signal.aborted) abortListener();
      });
      const answer = await Promise.race([wait, paste, aborted]);
      manual.abort();
      await authorizeMcp(auth, { serverUrl: spec.oauthUrl, authorizationCode: answer.code, iss: answer.iss, fetch: oauthFetch(interaction.signal) });
    }
    return credentials(store, callback.redirectUrl);
  } finally {
    if (abortListener) interaction.signal.removeEventListener("abort", abortListener);
    manual.abort(); await callback.close();
  }
}

export async function refreshWebProvider(spec: WebProviderSpec, current: OAuthCredential, signal: AbortSignal): Promise<OAuthCredential> {
  const saved = current.mcp as McpOAuthState | undefined;
  if (!saved || saved.serverUrl !== spec.oauthUrl || typeof current.redirectUrl !== "string") throw new Error("Missing MCP OAuth state. Run /login " + spec.id + " again.");
  const store = { state: structuredClone(saved) };
  const auth = provider(spec, current.redirectUrl, store, () => { throw new Error("Sign-in expired. Run /login " + spec.id + " again."); });
  const result = await authorizeMcp(auth, { serverUrl: spec.oauthUrl, fetch: oauthFetch(signal) });
  if (result !== "AUTHORIZED") throw new Error("Run /login " + spec.id + " again.");
  return credentials(store, current.redirectUrl);
}

export function webAuthProvider(spec: WebProviderSpec): Provider {
  return {
    id: spec.id, name: spec.name, getModels: () => [],
    auth: {
      apiKey: {
        name: spec.name + " API key",
        async login(interaction) { interaction.signal.throwIfAborted(); const key = await interaction.prompt({ type: "secret", message: "Enter your " + spec.name + " API key." }); interaction.signal.throwIfAborted(); if (!key.trim()) throw new Error("An API key is required."); return { type: "api_key", key: key.trim() }; },
        async check({ ctx, credential, signal }) { signal.throwIfAborted(); const key = credential?.key || await ctx.env(spec.keyEnv); signal.throwIfAborted(); return key ? { type: "api_key", source: spec.name + " API key" } : undefined; },
        async resolve({ ctx, credential, signal }) { signal.throwIfAborted(); const key = credential?.key || await ctx.env(spec.keyEnv); signal.throwIfAborted(); return key ? { auth: { apiKey: key }, source: spec.name + " API key" } : undefined; },
      },
      oauth: { name: spec.name + " OAuth", login: (interaction) => loginWebProvider(spec, interaction), refresh: (credential, signal) => refreshWebProvider(spec, credential, signal), async toAuth(credential) { return { apiKey: credential.access, baseUrl: spec.oauthUrl }; } },
    },
    stream() { throw new Error(spec.name + " is a web provider, not a chat model."); },
    streamSimple() { throw new Error(spec.name + " is a web provider, not a chat model."); },
  };
}
