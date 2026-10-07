import type { WebProviderId } from "../config.ts";
export interface WebProviderSpec { id: WebProviderId; name: string; anonymousUrl: string; oauthUrl: string; keyEnv: string; keyHeader: string; searchNames: string[]; fetchNames: string[]; docs: string; }
export const webProviders: Record<WebProviderId, WebProviderSpec> = {
  exa: { id: "exa", name: "Exa", anonymousUrl: "https://mcp.exa.ai/mcp", oauthUrl: "https://mcp.exa.ai/mcp?login", keyEnv: "EXA_API_KEY", keyHeader: "Authorization", searchNames: ["web_search_exa", "web_search_advanced_exa"], fetchNames: ["web_fetch_exa", "crawling_exa"], docs: "https://exa.ai/docs/get-started/exa-mcp" },
  parallel: { id: "parallel", name: "Parallel", anonymousUrl: "https://search.parallel.ai/mcp", oauthUrl: "https://search.parallel.ai/mcp-oauth", keyEnv: "PARALLEL_API_KEY", keyHeader: "Authorization", searchNames: ["web_search", "search", "search_web"], fetchNames: ["web_fetch", "extract", "fetch", "extract_web"], docs: "https://docs.parallel.ai/integrations/mcp/quickstart" },
};
