import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { create } from 'zustand';
import type { StreamFn } from '../stores/chat';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';

// AI 配置（key / baseUrl / model）都在 Rust 后端持久化，前端用 zustand store
// 镜像一份供 UI 订阅（状态栏模型名等需要响应式）；key 本身不回显。
interface AiConfigState {
  hasKey: boolean;
  baseUrl: string;
  model: string;
}

export const useAiConfigStore = create<AiConfigState>(() => ({
  hasKey: false,
  baseUrl: DEFAULT_BASE_URL,
  model: DEFAULT_MODEL,
}));

export function isApiKeyConfigured(): boolean {
  return useAiConfigStore.getState().hasKey;
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
}

/** 启动时同步一次 Rust 侧配置（key 是否已配 / baseUrl / model）。 */
export async function refreshAiConfig(): Promise<void> {
  try {
    const info = await invoke<AiConfigInfoRust>('get_ai_config');
    useAiConfigStore.setState({ hasKey: info.has_key, baseUrl: info.base_url, model: info.model });
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
