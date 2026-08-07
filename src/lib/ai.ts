import Anthropic from '@anthropic-ai/sdk';
import type { StreamFn } from '../stores/chat';

const KEY_STORAGE = 'ai-terminal-api-key';
const MODEL_STORAGE = 'ai-terminal-model';
const DEFAULT_MODEL = 'claude-sonnet-5';

export function getApiKey(): string | null {
  return localStorage.getItem(KEY_STORAGE);
}
export function setApiKey(key: string) {
  localStorage.setItem(KEY_STORAGE, key.trim());
}
export function getModel(): string {
  return localStorage.getItem(MODEL_STORAGE) ?? DEFAULT_MODEL;
}

export const anthropicStream: StreamFn = async (messages, onChunk) => {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('尚未配置 API Key，请先在顶部输入');
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const stream = client.messages.stream({
    model: getModel(),
    max_tokens: 8192,
    messages: messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
  });
  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      onChunk(event.delta.text);
    }
  }
};
