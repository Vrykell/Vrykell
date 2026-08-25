import { describe, it, expect, vi, beforeEach } from 'vitest';

const { invokeMock, listenMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  listenMock: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }));

import { anthropicStream, activeModelProfile, isApiKeyConfigured, getModel, getAiBaseUrl, useAiConfigStore, refreshAiConfig, setApiKey, clearApiKey, setAiBaseUrl, setAiModel, setAiProvider, setAiModels, setActiveModel, setProviderKey, clearProviderKey, setTavilyKey, clearTavilyKey } from './ai';

describe('anthropicStream', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    listenMock.mockReset();
  });

  it('后端报错时抛出错误', async () => {
    listenMock.mockResolvedValue(() => {});
    invokeMock.mockRejectedValue('尚未配置 API Key');
    await expect(anthropicStream([], () => {})).rejects.toThrow('尚未配置 API Key');
  });

  it('把 ai-chunk 事件逐块转发给 onChunk', async () => {
    let handler: ((e: { payload: { id: string; text: string } }) => void) | undefined;
    listenMock.mockImplementation(async (_event: string, cb: typeof handler) => {
      handler = cb;
      return () => {};
    });
    invokeMock.mockImplementation(async (_cmd: string, args: { id: string }) => {
      // 模拟后端逐块 emit，id 用真实调用参数，验证按 id 过滤
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

describe('ai 镜像函数（新增）', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('activeModelProfile：优先列表命中，空列表回退镜像字段', () => {
    useAiConfigStore.setState({ models: [{ id: 'a', name: 'A', provider: 'anthropic', baseUrl: 'u', model: 'm1' }], activeModel: 'a' });
    expect(activeModelProfile().model).toBe('m1');
    useAiConfigStore.setState({ models: [], activeModel: '', provider: 'gemini', baseUrl: 'u2', model: 'm2' });
    expect(activeModelProfile().model).toBe('m2');
  });

  it('isApiKeyConfigured：按 provider 检查 key', () => {
    useAiConfigStore.setState({ hasKey: true, provider: 'openai-compatible' });
    expect(isApiKeyConfigured()).toBe(true);
    useAiConfigStore.setState({ hasKey: false, hasAnthropicKey: true, provider: 'anthropic' });
    expect(isApiKeyConfigured()).toBe(true);
    useAiConfigStore.setState({ hasKey: false, hasAnthropicKey: false, provider: 'anthropic' });
    expect(isApiKeyConfigured()).toBe(false);
  });

  it('getModel / getAiBaseUrl 返回镜像值', () => {
    useAiConfigStore.setState({ model: 'm3', baseUrl: 'u3' });
    expect(getModel()).toBe('m3');
    expect(getAiBaseUrl()).toBe('u3');
  });

  it('getModel / getAiBaseUrl 空值时回退默认', () => {
    useAiConfigStore.setState({ model: '', baseUrl: '' });
    expect(getModel()).toBe('gpt-4o-mini');
    expect(getAiBaseUrl()).toBe('https://api.openai.com/v1');
  });

  it('activeModelProfile：列表无命中时取第一项', () => {
    useAiConfigStore.setState({
      models: [{ id: 'a', name: 'A', provider: 'gemini', baseUrl: 'u', model: 'g1' }],
      activeModel: '不存在的id',
    });
    expect(activeModelProfile().model).toBe('g1');
  });

  it('isApiKeyConfigured：gemini 分支', () => {
    useAiConfigStore.setState({ hasGeminiKey: true, provider: 'gemini' });
    expect(isApiKeyConfigured()).toBe(true);
    useAiConfigStore.setState({ hasGeminiKey: false, provider: 'gemini' });
    expect(isApiKeyConfigured()).toBe(false);
    
  });

  it('refreshAiConfig：同步 Rust 配置；后端不可用时保持默认', async () => {
    invokeMock.mockResolvedValue({
      has_key: true, base_url: 'u', model: 'm', provider: 'anthropic',
      has_anthropic_key: true, has_gemini_key: false, has_tavily_key: true,
      models: [{ id: 'x', name: 'X', provider: 'anthropic', baseUrl: 'u', model: 'm' }],
      active_model: 'x',
    });
    await refreshAiConfig();
    const s = useAiConfigStore.getState();
    expect(s.hasKey).toBe(true);
    expect(s.provider).toBe('anthropic');
    expect(s.hasTavilyKey).toBe(true);
    expect(s.models[0].id).toBe('x');
    expect(s.activeModel).toBe('x');
    invokeMock.mockRejectedValueOnce(new Error('后端未就绪'));
    useAiConfigStore.setState({ model: 'keep' });
    await refreshAiConfig();
    expect(useAiConfigStore.getState().model).toBe('keep');
  });

  it('refreshAiConfig：models 缺省时兜底为空数组', async () => {
    invokeMock.mockResolvedValue({ has_key: false, base_url: 'u', model: 'm', provider: 'openai-compatible' });
    await refreshAiConfig();
    expect(useAiConfigStore.getState().models).toEqual([]);
  });

  it('setApiKey / clearApiKey / setAiBaseUrl / setAiModel / setAiProvider', async () => {
    await setApiKey('  sk-abc  ');
    expect(invokeMock).toHaveBeenCalledWith('set_ai_key', { key: 'sk-abc' });
    expect(useAiConfigStore.getState().hasKey).toBe(true);
    await setApiKey('   ');
    expect(invokeMock).toHaveBeenCalledTimes(1);
    await clearApiKey();
    expect(invokeMock).toHaveBeenCalledWith('clear_ai_key');
    expect(useAiConfigStore.getState().hasKey).toBe(false);
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

  it('setAiModels：替换列表并同步镜像字段，未命中时回退默认', async () => {
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

  it('setActiveModel：切换生效模型，未命中回退默认', async () => {
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

  it('setProviderKey / clearProviderKey：按 provider 分支', async () => {
    await setProviderKey('anthropic', ' key-a ');
    expect(invokeMock).toHaveBeenCalledWith('set_provider_key', { provider: 'anthropic', key: 'key-a' });
    expect(useAiConfigStore.getState().hasAnthropicKey).toBe(true);
    await setProviderKey('gemini', 'k');
    expect(useAiConfigStore.getState().hasGeminiKey).toBe(true);
    await setProviderKey('openai-compatible', 'k');
    expect(useAiConfigStore.getState().hasKey).toBe(true);
    await setProviderKey('anthropic', '  ');
    expect(invokeMock).toHaveBeenCalledTimes(3);
    await clearProviderKey('gemini');
    expect(invokeMock).toHaveBeenCalledWith('clear_provider_key', { provider: 'gemini' });
    expect(useAiConfigStore.getState().hasGeminiKey).toBe(false);
    await clearProviderKey('anthropic');
    expect(useAiConfigStore.getState().hasAnthropicKey).toBe(false);
    await clearProviderKey('openai-compatible');
    expect(useAiConfigStore.getState().hasKey).toBe(false);
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
});
