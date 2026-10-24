import { describe, expect, it } from 'vitest';
import type { ProviderKind } from '@features/agent/services/provider';
import {
  effectiveBaseUrl,
  providerHasKey,
  providerId,
  providerList,
  providerName,
} from './providerList';

describe('effectiveBaseUrl', () => {
  it('空串解析为该 kind 的默认端点', () => {
    expect(effectiveBaseUrl('anthropic', '')).toBe('https://api.anthropic.com/v1');
    expect(effectiveBaseUrl('openai-compatible', '  ')).toBe('https://api.openai.com/v1');
    expect(effectiveBaseUrl('opencode', '')).toBe('https://opencode.ai/zen/go/v1');
  });

  it('默认端点与带尾斜杠的写法归一到同一值', () => {
    expect(effectiveBaseUrl('anthropic', 'https://api.anthropic.com/v1/')).toBe('https://api.anthropic.com/v1');
    expect(effectiveBaseUrl('openai-compatible', 'https://api.deepseek.com/v1/')).toBe('https://api.deepseek.com/v1');
  });

  it('自定义端点仅去掉尾斜杠', () => {
    expect(effectiveBaseUrl('openai-compatible', 'http://127.0.0.1:11434/v1')).toBe('http://127.0.0.1:11434/v1');
  });
});

describe('providerName', () => {
  it('命中预设时用预设名（空串与默认端点一致）', () => {
    expect(providerName('anthropic', '')).toBe('Anthropic');
    expect(providerName('anthropic', 'https://api.anthropic.com/v1')).toBe('Anthropic');
    expect(providerName('openai-compatible', 'https://api.deepseek.com/v1')).toBe('DeepSeek');
    expect(providerName('opencode', '')).toBe('OpenCode Go');
    expect(providerName('opencode', 'https://opencode.ai/zen/v1')).toBe('OpenCode Zen');
  });

  it('未命中预设时退回主机名', () => {
    expect(providerName('openai-compatible', 'http://127.0.0.1:11434/v1')).toBe('127.0.0.1:11434');
  });

  it('无法解析的地址返回空名（界面回退到家族标签）', () => {
    expect(providerName('openai-compatible', 'not a url')).toBe('');
  });
});

describe('providerList', () => {
  const row = (id: string, provider: ProviderKind, baseUrl: string) => ({ id, provider, baseUrl });

  it('按 kind+端点分组，保持首次出现顺序，模型归入各自的 provider', () => {
    const rows = providerList([
      row('a', 'anthropic', ''),
      row('b', 'openai-compatible', 'https://api.deepseek.com/v1'),
      row('c', 'anthropic', 'https://api.anthropic.com/v1/'),
      row('d', 'openai-compatible', 'https://api.deepseek.com/v1/'),
    ]);
    expect(rows.map((entry) => entry.id)).toEqual([
      'anthropic|https://api.anthropic.com/v1',
      'openai-compatible|https://api.deepseek.com/v1',
    ]);
    expect(rows[0].models.map((model) => model.id)).toEqual(['a', 'c']);
    expect(rows[1].models.map((model) => model.id)).toEqual(['b', 'd']);
    expect(rows[0].name).toBe('Anthropic');
    expect(rows[1].name).toBe('DeepSeek');
  });

  it('不同端点各成一行；空列表返回空数组', () => {
    const rows = providerList([
      row('x', 'openai-compatible', 'http://127.0.0.1:11434/v1'),
      row('y', 'openai-compatible', 'https://api.moonshot.cn/v1'),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0].id).not.toBe(rows[1].id);
    expect(providerList([])).toEqual([]);
  });
});

describe('providerHasKey / providerId', () => {
  it('按 provider 身份取密钥标记', () => {
    const flags = { providerKeys: ['anthropic|https://api.anthropic.com/v1'] };
    expect(providerHasKey('anthropic|https://api.anthropic.com/v1', flags)).toBe(true);
    expect(providerHasKey('openai-compatible|https://api.openai.com/v1', flags)).toBe(false);
    expect(providerHasKey('gemini|https://generativelanguage.googleapis.com/v1beta', flags)).toBe(false);
  });

  it('id 与端点归一化一致', () => {
    expect(providerId('anthropic', '')).toBe(providerId('anthropic', 'https://api.anthropic.com/v1/'));
  });
});
