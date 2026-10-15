/**
 * providerList — the providers a model list is made of, for the provider rail.
 *
 * A provider here is an endpoint: one API family (provider kind) plus one effective base URL.
 * That is the identity the model list actually carries, so two models with the same kind and
 * endpoint are one provider, a model whose endpoint changes moves to another provider, and an
 * empty base URL counts as the vendor default it resolves to. Rows keep the list's own order.
 */
import { MODEL_PRESETS } from '@config/modelPresets';
import { baseUrlForProvider, type ProviderKind } from '@features/agent/services/provider';

/** The base URL a request will actually use: defaults resolved, trailing slashes trimmed. */
export function effectiveBaseUrl(kind: ProviderKind, baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  return baseUrlForProvider(trimmed, kind).replace(/\/+$/, '');
}

/** Stable identity of one provider row. */
export function providerId(kind: ProviderKind, baseUrl: string): string {
  return `${kind}|${effectiveBaseUrl(kind, baseUrl)}`;
}

function endpointHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

/** Display name: the preset this endpoint matches, else its host, else an empty string. */
export function providerName(kind: ProviderKind, baseUrl: string): string {
  const effective = effectiveBaseUrl(kind, baseUrl);
  const preset = MODEL_PRESETS.find(
    (entry) => entry.provider === kind && effectiveBaseUrl(entry.provider, entry.baseUrl) === effective,
  );
  return preset?.name ?? endpointHost(effective);
}

export interface ProviderRow<T> {
  /** Stable identity (see `providerId`). */
  id: string;
  kind: ProviderKind;
  /** Effective base URL this provider sends requests to. */
  baseUrl: string;
  /** Preset name or endpoint host; '' when the endpoint is unparseable. */
  name: string;
  /** The models of this provider, in list order. */
  models: T[];
}

/** Group a model list into provider rows, first appearance first. */
export function providerList<T extends { provider: ProviderKind; baseUrl: string }>(models: T[]): ProviderRow<T>[] {
  const rows = new Map<string, ProviderRow<T>>();
  for (const model of models) {
    const id = providerId(model.provider, model.baseUrl);
    let row = rows.get(id);
    if (!row) {
      row = {
        id,
        kind: model.provider,
        baseUrl: effectiveBaseUrl(model.provider, model.baseUrl),
        name: providerName(model.provider, model.baseUrl),
        models: [],
      };
      rows.set(id, row);
    }
    row.models.push(model);
  }
  return [...rows.values()];
}

/** Whether the key of this provider's API family is configured. */
export function providerHasKey(
  kind: ProviderKind,
  flags: { hasKey: boolean; hasAnthropicKey: boolean; hasGeminiKey: boolean },
): boolean {
  if (kind === 'anthropic') return flags.hasAnthropicKey;
  if (kind === 'gemini') return flags.hasGeminiKey;
  return flags.hasKey;
}
