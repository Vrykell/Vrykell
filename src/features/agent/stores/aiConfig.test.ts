import { describe, it, expect, vi, beforeEach } from 'vitest';

const { invokeMock, listenMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  listenMock: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }));

import { anthropicStream, activeModelProfile, isApiKeyConfigured, getModel, getAiBaseUrl, useAiConfigStore, refreshAiConfig, setApiKey, clearApiKey, setAiBaseUrl, setAiModel, setAiProvider, setAiModels, setActiveModel, setProviderKey, clearProviderKey, setTavilyKey, clearTavilyKey, selectProvider } from '@features/agent/stores/aiConfig';

describe('anthropicStream', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    listenMock.mockReset();
  });

  it('throws when the backend reports an error', async () => {
    listenMock.mockResolvedValue(() => {});
    invokeMock.mockRejectedValue('尚未配置 API Key');
    await expect(anthropicStream([], () => {})).rejects.toThrow('尚未配置 API Key');
  });

  it('forwards ai-chunk events to onChunk chunk by chunk', async () => {
    let handler: ((e: { payload: { id: string; text: string } }) => void) | undefined;
    listenMock.mockImplementation(async (_event: string, cb: typeof handler) => {
      handler = cb;
      return () => {};
    });
    invokeMock.mockImplementation(async (_cmd: string, args: { id: string }) => {
      // Simulate the backend emitting chunks; use the real call id to verify id filtering
      handler?.({ payload: { id: args.id, text: '你好' } });
      handler?.({ payload: { id: args.id, text: '！' } });
      handler?.({ payload: { id: 'other-id', text: '（应被过滤）' } });
    });
    const got: string[] = [];
    await anthropicStream([{ role: 'user', content: 'hi' }], (t) => got.push(t));
    expect(got).toEqual(['你好', '！']);
    expect(invokeMock).toHaveBeenCalledWith('ai_stream', expect.objectContaining({
      messages: [{ role: 'user', content: 'hi' }],
    }));
  });
});

describe('ai mirror helpers (new)', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('activeModelProfile: prefers a list hit, falls back to mirror fields when the list is empty', () => {
    useAiConfigStore.setState({ models: [{ id: 'a', name: 'A', provider: 'anthropic', baseUrl: 'u', model: 'm1' }], activeModel: 'a' });
    expect(activeModelProfile().model).toBe('m1');
    useAiConfigStore.setState({ models: [], activeModel: '', provider: 'gemini', baseUrl: 'u2', model: 'm2' });
    expect(activeModelProfile().model).toBe('m2');
  });

  it('isApiKeyConfigured: checks the key per provider', () => {
    useAiConfigStore.setState({
      providerKeys: ['openai-compatible|https://api.openai.com/v1'],
      provider: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', models: [], activeModel: '',
    });
    expect(isApiKeyConfigured()).toBe(true);
    useAiConfigStore.setState({ providerKeys: ['anthropic|https://api.anthropic.com/v1'], provider: 'anthropic', baseUrl: '' });
    expect(isApiKeyConfigured()).toBe(true);
    useAiConfigStore.setState({ providerKeys: [] });
    expect(isApiKeyConfigured()).toBe(false);
  });

  it('getModel / getAiBaseUrl return the mirror values', () => {
    useAiConfigStore.setState({ model: 'm3', baseUrl: 'u3' });
    expect(getModel()).toBe('m3');
    expect(getAiBaseUrl()).toBe('u3');
  });

  it('getModel / getAiBaseUrl fall back to defaults when empty', () => {
    useAiConfigStore.setState({ model: '', baseUrl: '' });
    expect(getModel()).toBe('gpt-4o-mini');
    expect(getAiBaseUrl()).toBe('https://api.openai.com/v1');
  });

  it('activeModelProfile: takes the first entry when the list has no match', () => {
    useAiConfigStore.setState({
      models: [{ id: 'a', name: 'A', provider: 'gemini', baseUrl: 'u', model: 'g1' }],
      activeModel: '不存在的id',
    });
    expect(activeModelProfile().model).toBe('g1');
  });

  it('isApiKeyConfigured: gemini branch', () => {
    useAiConfigStore.setState({
      providerKeys: ['gemini|https://generativelanguage.googleapis.com/v1beta'],
      provider: 'gemini', baseUrl: '', models: [], activeModel: '',
    });
    expect(isApiKeyConfigured()).toBe(true);
    useAiConfigStore.setState({ providerKeys: [] });
    expect(isApiKeyConfigured()).toBe(false);
  });

  it('refreshAiConfig: syncs the Rust config; keeps defaults when the backend is unavailable', async () => {
    invokeMock.mockResolvedValue({
      has_key: true, base_url: 'u', model: 'm', provider: 'anthropic',
      has_anthropic_key: true, has_gemini_key: false, has_tavily_key: true,
      provider_keys: ['anthropic|u'],
      models: [{ id: 'x', name: 'X', provider: 'anthropic', baseUrl: 'u', model: 'm' }],
      active_model: 'x',
    });
    await refreshAiConfig();
    const s = useAiConfigStore.getState();
    expect(s.providerKeys).toEqual(['anthropic|u']);
    expect(s.provider).toBe('anthropic');
    expect(s.hasTavilyKey).toBe(true);
    expect(s.models[0].id).toBe('x');
    expect(s.activeModel).toBe('x');
    invokeMock.mockRejectedValueOnce(new Error('后端未就绪'));
    useAiConfigStore.setState({ model: 'keep' });
    await refreshAiConfig();
    expect(useAiConfigStore.getState().model).toBe('keep');
  });

  it('refreshAiConfig: falls back to an empty array when models is missing', async () => {
    invokeMock.mockResolvedValue({ has_key: false, base_url: 'u', model: 'm', provider: 'openai-compatible' });
    await refreshAiConfig();
    expect(useAiConfigStore.getState().models).toEqual([]);
  });

  it('setApiKey / clearApiKey / setAiBaseUrl / setAiModel / setAiProvider', async () => {
    useAiConfigStore.setState({
      provider: 'openai-compatible', baseUrl: 'https://api.openai.com/v1',
      models: [], activeModel: '', providerKeys: [],
    });
    await setApiKey('  sk-abc  ');
    expect(invokeMock).toHaveBeenCalledWith('set_provider_key', {
      providerId: 'openai-compatible|https://api.openai.com/v1', key: 'sk-abc',
    });
    expect(useAiConfigStore.getState().providerKeys).toEqual(['openai-compatible|https://api.openai.com/v1']);
    await setApiKey('   ');
    expect(invokeMock).toHaveBeenCalledTimes(1);
    await clearApiKey();
    expect(invokeMock).toHaveBeenCalledWith('clear_provider_key', { providerId: 'openai-compatible|https://api.openai.com/v1' });
    expect(useAiConfigStore.getState().providerKeys).toEqual([]);
    await setAiBaseUrl('  http://x  ');
    expect(invokeMock).toHaveBeenCalledWith('set_ai_base_url', { baseUrl: 'http://x' });
    expect(useAiConfigStore.getState().baseUrl).toBe('http://x');
    await setAiBaseUrl('');
    expect(invokeMock).toHaveBeenCalledTimes(3);
    await setAiModel('  m9  ');
    expect(invokeMock).toHaveBeenCalledWith('set_ai_model', { model: 'm9' });
    expect(useAiConfigStore.getState().model).toBe('m9');
    await setAiProvider('gemini');
    expect(invokeMock).toHaveBeenCalledWith('set_ai_provider', { provider: 'gemini' });
    expect(useAiConfigStore.getState().provider).toBe('gemini');
  });

  it('setAiModels: replaces the list and syncs mirror fields, falling back to defaults on a miss', async () => {
    await setAiModels([{ id: 'a', name: 'A', provider: 'anthropic', baseUrl: 'u', model: 'm1' }], 'a');
    expect(invokeMock).toHaveBeenCalledWith('set_ai_models', expect.objectContaining({ activeModel: 'a' }));
    const s = useAiConfigStore.getState();
    expect(s.models[0].id).toBe('a');
    expect(s.provider).toBe('anthropic');
    await setAiModels([], '不存在');
    const s2 = useAiConfigStore.getState();
    expect(s2.models).toEqual([]);
    expect(s2.provider).toBe('openai-compatible');
    expect(s2.model).toBe('gpt-4o-mini');
  });

  it('setActiveModel: switches the effective model, falls back to defaults on a miss', async () => {
    useAiConfigStore.setState({ models: [{ id: 'b', name: 'B', provider: 'gemini', baseUrl: 'u', model: 'g9' }], activeModel: '' });
    await setActiveModel('b');
    expect(invokeMock).toHaveBeenCalledWith('set_active_model', { id: 'b' });
    const s = useAiConfigStore.getState();
    expect(s.activeModel).toBe('b');
    expect(s.provider).toBe('gemini');
    expect(s.model).toBe('g9');
    await setActiveModel('不存在');
    expect(useAiConfigStore.getState().provider).toBe('gemini');
    useAiConfigStore.setState({ models: [] });
    await setActiveModel('不存在');
    expect(useAiConfigStore.getState().provider).toBe('openai-compatible');
  });

  it('setProviderKey / clearProviderKey: stores keys separately per provider identity', async () => {
    await setProviderKey('anthropic|https://api.anthropic.com/v1', ' key-a ');
    expect(invokeMock).toHaveBeenCalledWith('set_provider_key', {
      providerId: 'anthropic|https://api.anthropic.com/v1', key: 'key-a',
    });
    expect(useAiConfigStore.getState().providerKeys).toEqual(['anthropic|https://api.anthropic.com/v1']);
    await setProviderKey('gemini|https://generativelanguage.googleapis.com/v1beta', 'k');
    await setProviderKey('openai-compatible|https://api.deepseek.com/v1', 'k');
    expect(useAiConfigStore.getState().providerKeys).toHaveLength(3);
    await setProviderKey('anthropic|https://api.anthropic.com/v1', '  ');
    expect(invokeMock).toHaveBeenCalledTimes(3);
    await clearProviderKey('gemini|https://generativelanguage.googleapis.com/v1beta');
    expect(invokeMock).toHaveBeenCalledWith('clear_provider_key', { providerId: 'gemini|https://generativelanguage.googleapis.com/v1beta' });
    expect(useAiConfigStore.getState().providerKeys).toHaveLength(2);
    await clearProviderKey('openai-compatible|https://api.deepseek.com/v1');
    expect(useAiConfigStore.getState().providerKeys).toEqual(['anthropic|https://api.anthropic.com/v1']);
  });

  it('setTavilyKey / clearTavilyKey', async () => {
    await setTavilyKey(' tv-1 ');
    expect(invokeMock).toHaveBeenCalledWith('set_tavily_key', { key: 'tv-1' });
    expect(useAiConfigStore.getState().hasTavilyKey).toBe(true);
    await setTavilyKey('');
    expect(invokeMock).toHaveBeenCalledTimes(1);
    await clearTavilyKey();
    expect(useAiConfigStore.getState().hasTavilyKey).toBe(false);
  });

  it('selectProvider: remembers the choice in localStorage, null clears it', () => {
    selectProvider('anthropic|https://api.anthropic.com/v1');
    const s = useAiConfigStore.getState();
    expect(s.selectedProvider).toBe('anthropic|https://api.anthropic.com/v1');
    expect(s.lastSelectedProvider).toBe('anthropic|https://api.anthropic.com/v1');
    expect(localStorage.getItem('vrykell-ai-provider')).toBe('anthropic|https://api.anthropic.com/v1');
    selectProvider(null);
    expect(useAiConfigStore.getState().selectedProvider).toBeNull();
    expect(useAiConfigStore.getState().lastSelectedProvider).toBeNull();
    expect(localStorage.getItem('vrykell-ai-provider')).toBe('');
  });
});
