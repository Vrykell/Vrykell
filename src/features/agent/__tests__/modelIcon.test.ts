import { describe, expect, it } from 'vitest';
import { modelVendor, modelVendorInfo } from '@features/agent/components/modelIcon';
import { AnthropicMark, GroqMark, MoonshotMark, OllamaMark, OpenCodeMark, QwenMark } from '@ui/brandMarks';
import { Server } from '@ui/icons';

describe('modelVendor', () => {
  it('reads the endpoint host before the model name', () => {
    expect(modelVendor('openai-compatible', 'llama-3.3-70b-versatile', 'https://api.groq.com/openai/v1')).toBe('groq');
    expect(modelVendor('openai-compatible', 'deepseek-ai/DeepSeek-V3', 'https://api.siliconflow.cn/v1')).toBe('siliconflow');
    expect(modelVendor('openai-compatible', 'gpt-4o-mini', 'https://api.openai.com/v1')).toBe('openai');
    expect(modelVendor('openai-compatible', 'moonshot-v1-128k', 'https://api.moonshot.cn/v1')).toBe('moonshot');
    expect(modelVendor('opencode', 'deepseek-v4.1-flash', 'https://opencode.ai/zen/go/v1')).toBe('opencode');
  });

  it('recognises loopback and LAN endpoints as local servers', () => {
    expect(modelVendor('openai-compatible', 'qwen2.5-coder:7b', 'http://localhost:11434/v1')).toBe('ollama');
    expect(modelVendor('openai-compatible', 'llama-3', 'http://127.0.0.1:8000/v1')).toBe('local');
    expect(modelVendor('openai-compatible', 'llama-3', 'http://192.168.1.8:8080/v1')).toBe('local');
    expect(modelVendorInfo('openai-compatible', 'llama-3', 'http://10.0.0.5:1234/v1').mark).toBe(Server);
  });

  it('falls back to the model family and then to the provider kind', () => {
    expect(modelVendorInfo('openai-compatible', 'claude-sonnet-4-5', '').mark).toBe(AnthropicMark);
    expect(modelVendorInfo('openai-compatible', 'kimi-k2', '').mark).toBe(MoonshotMark);
    expect(modelVendor('gemini', '', '')).toBe('gemini');
    expect(modelVendor('opencode', '', '')).toBe('opencode');
    expect(modelVendorInfo('opencode', '', '').mark).toBe(OpenCodeMark);
    expect(modelVendor('openai-compatible', 'mystery-model', '')).toBe('generic');
    expect(modelVendorInfo('openai-compatible', 'mystery-model', '').label).toBe('openai-compatible');
  });

  it('shows the drawn mark of a local Ollama model', () => {
    expect(modelVendorInfo('openai-compatible', 'qwen2.5-coder:7b', 'http://127.0.0.1:11434/v1').mark).toBe(OllamaMark);
    expect(modelVendorInfo('openai-compatible', 'llama-3.3-70b-versatile', 'https://api.groq.com/openai/v1').mark).toBe(GroqMark);
    expect(modelVendorInfo('openai-compatible', 'qwen-plus', 'https://dashscope.aliyuncs.com/compatible-mode/v1').mark).toBe(QwenMark);
  });
});
