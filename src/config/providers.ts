/**
 * providers — the API families a model entry can use, as data.
 *
 * The table lives in `providers.json` next to this file: a family's identifier, its display
 * label, its default endpoint and, when the service routes requests by conversation, the session
 * header and hosts that carry it. The request layer and the settings UI read this table instead
 * of hardcoding a family's endpoint or header.
 */
import providerData from './providers.json';

export type ProviderKind = 'openai-compatible' | 'anthropic' | 'gemini' | 'opencode';

/** A conversation-routing header an endpoint requires on chat requests. */
export interface ProviderSessionRoute {
  /** Header name the endpoint reads. */
  header: string;
  /** Hosts served by the endpoint; subdomains are included. */
  hosts: string[];
}

export interface ProviderDefinition {
  kind: ProviderKind;
  /** Display label; brand names are used as labels only. */
  label: string;
  /** Endpoint used when a model entry leaves its base URL empty. */
  defaultBaseUrl: string;
  /** Present when the endpoint routes a conversation by a header. */
  session?: ProviderSessionRoute;
}

export const PROVIDERS: ProviderDefinition[] = providerData as ProviderDefinition[];

/** Default endpoint per family, keyed by the family identifier. */
export const DEFAULT_BASE_URLS = Object.fromEntries(
  PROVIDERS.map((provider) => [provider.kind, provider.defaultBaseUrl]),
) as Record<ProviderKind, string>;

/** The definition of one family; unknown identifiers fall back to the first entry. */
export function providerDefinition(kind: ProviderKind): ProviderDefinition {
  return PROVIDERS.find((provider) => provider.kind === kind) ?? PROVIDERS[0];
}

/** The session header an endpoint requires for this URL, or null when it routes by other means. */
export function sessionHeaderFor(url: string): string | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  for (const provider of PROVIDERS) {
    const route = provider.session;
    if (!route) continue;
    for (const domain of route.hosts) {
      if (host === domain || host.endsWith(`.${domain}`)) return route.header;
    }
  }
  return null;
}
