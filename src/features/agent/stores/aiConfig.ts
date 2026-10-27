import { invoke } from '@platform/diagnostics';
import { t } from '@i18n';
import { listen } from '@tauri-apps/api/event';
import { create } from 'zustand';
import { safeLocalStorageGet, safeLocalStorageSet } from '@utils/errorHandler';
import type { StreamFn } from '@features/chat';
import type { ProviderKind } from '@features/agent/services/provider';
import { providerId } from '@features/agent/services/provider';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';
/** Where the model page remembers the last provider row the user picked. */
const PROVIDER_SELECTION_KEY = 'vrykell-ai-provider';

import type { ModelCapabilities } from '@features/agent/model/capabilities';

/** One usable model profile (a named profile). The API key is reused per provider rather than stored per model. */
export interface ModelProfile {
  id: string;
  name: string;
  provider: ProviderKind;
  baseUrl: string;
  model: string;
  providerName?: string;
  /** Custom group name; grouped by vendor when omitted. */
  group?: string;
  /** Capabilities probed on creation (vision/reasoning/tools/search); older data leaves them unset. */
  capabilities?: ModelCapabilities;
}

// AI configuration (provider / per-provider keys / baseUrl / model / model list) is persisted by
// the backend; the frontend mirrors it in a store so the UI can subscribe (the status bar model
// name needs to react). Keys themselves are never echoed back.
// provider/baseUrl/model mirror the "currently active model" so older code and the status bar can
// read them directly.
interface AiConfigState {
  baseUrl: string;
  model: string;
  provider: ProviderKind;
  /** Providers (endpoint ids) that hold their own API key. */
  providerKeys: string[];
  hasTavilyKey: boolean;
  /** Named model profiles. */
  models: ModelProfile[];
  /** Id of the currently active model. */
  activeModel: string;
  /** Provider row selected on the model page (session state). */
  selectedProvider: string | null;
  /** Provider row the user picked last; restored on the next visit. */
  lastSelectedProvider: string | null;
}

export const useAiConfigStore = create<AiConfigState>(() => ({
  baseUrl: DEFAULT_BASE_URL,
  model: DEFAULT_MODEL,
  provider: 'openai-compatible',
  providerKeys: [],
  hasTavilyKey: false,
  models: [],
  activeModel: '',
  selectedProvider: null,
  lastSelectedProvider: safeLocalStorageGet(PROVIDER_SELECTION_KEY) || null,
}));

/** Full profile of the active model; falls back to the mirror fields when the list is empty (older config or not refreshed yet). */
export function activeModelProfile(): ModelProfile {
  const s = useAiConfigStore.getState();
  return (
    s.models.find((m) => m.id === s.activeModel) ??
    s.models[0] ?? {
      id: 'default',
      name: '默认模型',
      provider: s.provider,
      baseUrl: s.baseUrl,
      model: s.model,
    }
  );
}

/** Whether the active model's provider has its own key configured. */
export function isApiKeyConfigured(): boolean {
  const s = useAiConfigStore.getState();
  const active = activeModelProfile();
  return s.providerKeys.includes(providerId(active.provider, active.baseUrl));
}

export function getModel(): string {
  return useAiConfigStore.getState().model || DEFAULT_MODEL;
}

export function getAiBaseUrl(): string {
  return useAiConfigStore.getState().baseUrl || DEFAULT_BASE_URL;
}

interface AiConfigInfoRust {
  has_key: boolean;
  base_url: string;
  model: string;
  provider: ProviderKind;
  has_anthropic_key: boolean;
  has_gemini_key: boolean;
  has_tavily_key: boolean;
  /** Providers (endpoint ids) that hold their own API key. */
  provider_keys: string[];
  models: ModelProfile[];
  active_model: string;
}

/** Sync the backend configuration once at startup (provider / which keys are configured / baseUrl / model / model list). */
export async function refreshAiConfig(): Promise<void> {
  try {
    const info = await invoke<AiConfigInfoRust>('get_ai_config');
    useAiConfigStore.setState({
      baseUrl: info.base_url,
      model: info.model,
      provider: info.provider,
      providerKeys: info.provider_keys ?? [],
      hasTavilyKey: info.has_tavily_key,
      models: info.models ?? [],
      activeModel: info.active_model ?? '',
    });
  } catch {
    // Ignore: keep the defaults when the backend is unavailable.
  }
}

/** Set the active model's provider key (the single-key entry points kept for older callers). */
export async function setApiKey(key: string): Promise<void> {
  const active = activeModelProfile();
  await setProviderKey(providerId(active.provider, active.baseUrl), key);
}

export async function clearApiKey(): Promise<void> {
  const active = activeModelProfile();
  await clearProviderKey(providerId(active.provider, active.baseUrl));
}

export async function setAiBaseUrl(baseUrl: string): Promise<void> {
  const u = baseUrl.trim();
  if (!u) return;
  await invoke('set_ai_base_url', { baseUrl: u });
  useAiConfigStore.setState({ baseUrl: u });
}

export async function setAiModel(model: string): Promise<void> {
  const m = model.trim();
  if (!m) return;
  await invoke('set_ai_model', { model: m });
  useAiConfigStore.setState({ model: m });
}

export async function setAiProvider(provider: ProviderKind): Promise<void> {
  await invoke('set_ai_provider', { provider });
  useAiConfigStore.setState({ provider });
}

/** Replace the model list and the active model in one go (used by the model settings page). */
export async function setAiModels(models: ModelProfile[], activeModel: string): Promise<void> {
  await invoke('set_ai_models', { models, activeModel });
  const active = models.find((m) => m.id === activeModel) ?? models[0];
  useAiConfigStore.setState({
    models,
    activeModel,
    provider: active?.provider ?? 'openai-compatible',
    baseUrl: active?.baseUrl ?? DEFAULT_BASE_URL,
    model: active?.model ?? DEFAULT_MODEL,
  });
}

/** Switch the active model by id. */
export async function setActiveModel(id: string): Promise<void> {
  await invoke('set_active_model', { id });
  const s = useAiConfigStore.getState();
  const active = s.models.find((m) => m.id === id) ?? s.models[0];
  useAiConfigStore.setState({
    activeModel: id,
    provider: active?.provider ?? 'openai-compatible',
    baseUrl: active?.baseUrl ?? DEFAULT_BASE_URL,
    model: active?.model ?? DEFAULT_MODEL,
  });
}

/** Remember which provider row the model page shows; the pick survives a reload. */
export function selectProvider(id: string | null): void {
  useAiConfigStore.setState({ selectedProvider: id, lastSelectedProvider: id });
  safeLocalStorageSet(PROVIDER_SELECTION_KEY, id ?? '');
}

/** Set one provider's key; the backend seals it and the store records the provider id. */
export async function setProviderKey(provider: string, key: string, copyFrom?: string): Promise<void> {
  const k = key.trim();
  if (!k && !copyFrom) return;
  try {
    await invoke('set_provider_key', { providerId: provider, key: k, ...(copyFrom ? { copyFrom } : {}) });
  } catch {
    throw new Error(t('Could not save the API key. Your previous key is unchanged.'));
  }
  const keys = useAiConfigStore.getState().providerKeys;
  if (!keys.includes(provider)) useAiConfigStore.setState({ providerKeys: [...keys, provider] });
}

export async function clearProviderKey(provider: string): Promise<void> {
  await invoke('clear_provider_key', { providerId: provider });
  useAiConfigStore.setState({
    providerKeys: useAiConfigStore.getState().providerKeys.filter((id) => id !== provider),
  });
}

/** The masked provider key for the settings display; the plaintext stays in the backend. */
export async function providerKeyHint(provider: string): Promise<string | null> {
  return invoke<string | null>('provider_key_hint', { providerId: provider });
}

/** The plaintext provider key, fetched only when the user explicitly asks to see or copy it. */
export async function providerKeyReveal(provider: string): Promise<string | null> {
  return invoke<string | null>('provider_key_reveal', { providerId: provider });
}

/** Ask the provider for its model list with its own key: the connection check and the model sync share this. */
export async function providerFetchModels(id: string, kind: ProviderKind, baseUrl: string): Promise<string[]> {
  return invoke<string[]>('provider_fetch_models', { providerId: id, provider: kind, baseUrl });
}

export async function setTavilyKey(key: string): Promise<void> {
  const k = key.trim();
  if (!k) return;
  await invoke('set_tavily_key', { key: k });
  useAiConfigStore.setState({ hasTavilyKey: true });
}

export async function clearTavilyKey(): Promise<void> {
  await invoke('clear_tavily_key');
  useAiConfigStore.setState({ hasTavilyKey: false });
}

let streamCounter = 0;

export const anthropicStream: StreamFn = async (messages, onChunk) => {
  const id = `ai-${Date.now()}-${streamCounter++}`;
  let unlisten: (() => void) | undefined;
  try {
    unlisten = await listen<{ id: string; text: string }>('ai-chunk', (e) => {
      if (e.payload.id === id) onChunk(e.payload.text);
    });
    await invoke('ai_stream', {
      id,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    });
  } finally {
    unlisten?.();
  }
};
