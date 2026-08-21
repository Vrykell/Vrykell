import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { create } from 'zustand';
import type { StreamFn } from '../stores/chat';
import type { ProviderKind } from '../agent/provider';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';

// AI 配置（provider / 各家 key / baseUrl / model）都在 Rust 后端持久化，前端用
// zustand store 镜像一份供 UI 订阅（状态栏模型名等需要响应式）；key 本身不回显。
interface AiConfigState {
  hasKey: boolean;
  baseUrl: string;
  model: string;
  provider: ProviderKind;
  hasAnthropicKey: boolean;
  hasGeminiKey: boolean;
  hasTavilyKey: boolean;
}

export const useAiConfigStore = create<AiConfigState>(() => ({
  hasKey: false,
  baseUrl: DEFAULT_BASE_URL,
  model: DEFAULT_MODEL,
  provider: 'openai-compatible',
  hasAnthropicKey: false,
  hasGeminiKey: false,
  hasTavilyKey: false,
}));

export function isApiKeyConfigured(): boolean {
  const s = useAiConfigStore.getState();
  switch (s.provider) {
    case 'anthropic':
      return s.hasAnthropicKey;
    case 'gemini':
      return s.hasGeminiKey;
    default:
      return s.hasKey;
  }
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
}

/** 启动时同步一次 Rust 侧配置（provider / 各家 key 是否已配 / baseUrl / model）。 */
export async function refreshAiConfig(): Promise<void> {
  try {
    const info = await invoke<AiConfigInfoRust>('get_ai_config');
    useAiConfigStore.setState({
      hasKey: info.has_key,
      baseUrl: info.base_url,
      model: info.model,
      provider: info.provider,
      hasAnthropicKey: info.has_anthropic_key,
      hasGeminiKey: info.has_gemini_key,
      hasTavilyKey: info.has_tavily_key,
    });
  } catch {
    // 忽略：后端不可用时保持默认
  }
}

export async function setApiKey(key: string): Promise<void> {
  const k = key.trim();
  if (!k) return;
  await invoke('set_ai_key', { key: k });
  useAiConfigStore.setState({ hasKey: true });
}

export async function clearApiKey(): Promise<void> {
  await invoke('clear_ai_key');
  useAiConfigStore.setState({ hasKey: false });
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

/** 按 provider 设置 key（'openai-compatible' 等价于 setApiKey） */
export async function setProviderKey(provider: ProviderKind, key: string): Promise<void> {
  const k = key.trim();
  if (!k) return;
  await invoke('set_provider_key', { provider, key: k });
  const patch =
    provider === 'anthropic'
      ? { hasAnthropicKey: true }
      : provider === 'gemini'
        ? { hasGeminiKey: true }
        : { hasKey: true };
  useAiConfigStore.setState(patch);
}

export async function clearProviderKey(provider: ProviderKind): Promise<void> {
  await invoke('clear_provider_key', { provider });
  const patch =
    provider === 'anthropic'
      ? { hasAnthropicKey: false }
      : provider === 'gemini'
        ? { hasGeminiKey: false }
        : { hasKey: false };
  useAiConfigStore.setState(patch);
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
