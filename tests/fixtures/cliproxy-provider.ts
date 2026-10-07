import { openAICompletionsApi, type Model } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI, ProviderConfig } from "@earendil-works/pi-coding-agent";

// Custom provider identity/implementation over a local protocol fixture, not CLIProxyAPI itself.
export const fixtureProvider = "cliproxyapi";
export const fixtureApi = "cliproxyapi-codex-responses";
export const fixtureModel = "gpt-provider-fixture";
export function providerConfig(baseUrl: string): ProviderConfig {
  return {
    name: "Fixture proxy", baseUrl: process.env.CODEMAX_DELEGATE_DEPTH && process.env.CODEMAX_FIXTURE_CHILD_ENDPOINT ? baseUrl + "/changed" : baseUrl, api: process.env.CODEMAX_DELEGATE_DEPTH ? process.env.CODEMAX_FIXTURE_CHILD_API ?? fixtureApi : fixtureApi, apiKey: "fixture",
    models: [{ id: process.env.CODEMAX_DELEGATE_DEPTH ? process.env.CODEMAX_FIXTURE_CHILD_MODEL ?? fixtureModel : fixtureModel, name: "Fixture GPT", reasoning: false, input: ["text"], contextWindow: 200000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple(model, context, options) {
      return openAICompletionsApi().streamSimple({ ...model, api: "openai-completions" } as Model<"openai-completions">, context, {
        ...options, headers: { ...options?.headers, "x-fixture-provider": fixtureProvider, "x-fixture-depth": process.env.CODEMAX_DELEGATE_DEPTH ?? "0" },
      });
    },
  };
}
export default function fixture(pi: ExtensionAPI): void {
  if (!process.env.CODEMAX_FIXTURE_URL) throw new Error("Missing fixture endpoint.");
  pi.registerProvider(fixtureProvider, providerConfig(process.env.CODEMAX_FIXTURE_URL));
  pi.registerCommand("cliproxyapi-refresh", { description: "Fixture provider command provenance", handler: async () => {} });
}
