import { SEARCH_PROVIDER_ORIGINS, availableSearchProviders } from "@workspace/web-core/provider";
import type { ProviderName, WebSearchResponse } from "@workspace/web-core";

type KeyedProvider = Exclude<ProviderName, "duckduckgo">;
type CredentialProbe = { provider: KeyedProvider; matched: boolean };
type SearchPorts = {
  hasCredential(origin: string): Promise<boolean>;
  search(queries: string[]): Promise<WebSearchResponse>;
};

export async function attestPublicSearch(ports: SearchPorts, queries: string[]) {
  const normalized = queries.map(query => query.trim()).filter(Boolean);
  const credentialChecks: CredentialProbe[] = [];
  const eligible = await availableSearchProviders(async origin => {
    const provider = (Object.keys(SEARCH_PROVIDER_ORIGINS) as KeyedProvider[]).find(
      key => SEARCH_PROVIDER_ORIGINS[key] === origin,
    );
    if (!provider) throw new Error("Search selected an unknown credential audience");
    const matched = await ports.hasCredential(origin);
    credentialChecks.push({ provider, matched });
    return matched;
  });
  const result = await ports.search(queries);
  if (!eligible.includes(result.provider))
    throw new Error("Public search provider does not match the caller's observed credential scope");
  if (result.results.length !== normalized.length ||
      result.results.some(({ query }, index) => query !== normalized[index]))
    throw new Error("Public search returned a different query batch");
  const urls = result.results.filter(row => !row.error).flatMap(({ sources }) => sources.map(({ url }) => url));
  return structuredClone({ queries, provider: result.provider, credentialChecks, result, urls });
}

export type PublicSearchReceipt = Awaited<ReturnType<typeof attestPublicSearch>>;
