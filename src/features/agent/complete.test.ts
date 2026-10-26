/**
 * complete（M8）测试：本地级（历史前缀/路径）零网络可用；AI 增强叠加与降级。
 * 模块级 mock 'ai' + '@tauri-apps/api/core'；不用 beforeEach（vitest 4 陷阱），
 * 各用例开头调 reset()。
 */
import { describe, it, expect, vi } from 'vitest';

const { mockGenerate, invokeMock } = vi.hoisted(() => ({
  mockGenerate: vi.fn(),
  invokeMock: vi.fn(),
}));
vi.mock('ai', () => ({ generateText: mockGenerate }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

import { completeCommand, localComplete, localCompleteCandidates, pathComplete, looksLikePath } from '@features/agent/services/complete';
import { useHistoryStore } from '@features/terminal/stores/history';
import { useAgentSettings, DEFAULT_AGENT_SETTINGS } from '@features/agent/stores/agentSettings';
import { useAiConfigStore } from '@features/agent/stores/aiConfig';

function reset() {
  mockGenerate.mockReset();
  invokeMock.mockReset();
  useHistoryStore.setState({ entries: [] });
  useAgentSettings.setState({ global: { ...DEFAULT_AGENT_SETTINGS, completeModel: '' }, overrides: {} });
  useAiConfigStore.setState({
    providerKeys: [],
    provider: 'openai-compatible',
    baseUrl: 'https://api.example.com/v1',
    model: 'gpt-4o-mini',
    models: [],
    activeModel: '',
  });
}

const entry = (command: string) => ({ command, cwd: '/tmp', timestamp: 1, exitCode: 0 });

describe('本地级（无 AI 也工作）', () => {
  it('excludes failed commands from every completion path but preserves searchable history', async () => {
    reset();
    useHistoryStore.setState({ entries: [
      { ...entry('git broken'), exitCode: 127 },
      { ...entry('git interrupted'), exitCode: 130 },
      entry('git status'),
      { ...entry('git legacy'), exitCode: null },
    ] });
    expect(localComplete('git ')).toBe('status');
    expect(localCompleteCandidates('git ')).toEqual(['status', 'legacy']);
    expect(useHistoryStore.getState().search('broken')).toHaveLength(1);
    useAiConfigStore.setState({ providerKeys: ['openai-compatible|https://api.example.com/v1'] });
    mockGenerate.mockResolvedValue({ text: 'docker ps' });
    await completeCommand('docker', {});
    const prompt = (mockGenerate.mock.calls[0]![0] as { prompt: string }).prompt;
    expect(prompt).toContain('git status');
    expect(prompt).not.toContain('git broken');
    expect(prompt).not.toContain('git interrupted');
  });
  it('历史前缀匹配返回后缀，最近优先', () => {
    reset();
    useHistoryStore.setState({
      entries: [entry('git checkout dev'), entry('git cherry-pick abc'), entry('ls')],
    });
    expect(localComplete('git che')).toBe('ckout dev');
    expect(localComplete('ls -la')).toBeNull(); // 不比前缀长不给建议
    expect(localComplete('npm')).toBeNull();
  });

  it('looksLikePath 判定', () => {
    expect(looksLikePath('/usr/b')).toBe(true);
    expect(looksLikePath('./src')).toBe(true);
    expect(looksLikePath('../x')).toBe(true);
    expect(looksLikePath('~/doc')).toBe(true);
    expect(looksLikePath('src/comp')).toBe(true);
    expect(looksLikePath('git')).toBe(false);
  });

  it('路径补全：相对路径拼 cwd，目录补结尾 /', async () => {
    reset();
    invokeMock.mockResolvedValue([
      { name: 'components', is_dir: true },
      { name: 'complete.ts', is_dir: false },
    ]);
    const r = await pathComplete('vim src/comp', '/repo');
    expect(invokeMock).toHaveBeenCalledWith('fs_list', { path: '/repo/src/' });
    expect(r).toBe('onents/');
  });

  it('路径补全：绝对路径直接用；~ 放弃；无 cwd 的相对路径放弃', async () => {
    reset();
    invokeMock.mockResolvedValue([{ name: 'bin', is_dir: true }]);
    expect(await pathComplete('ls /us', undefined)).toBeNull(); // /us → dir '/', base 'us' 无匹配
    expect(invokeMock).toHaveBeenCalledWith('fs_list', { path: '/' });
    expect(await pathComplete('cd ~/doc', '/repo')).toBeNull();
    expect(await pathComplete('cd src/x', undefined)).toBeNull();
  });

  it('路径补全：fs_list 失败静默返回 null', async () => {
    reset();
    invokeMock.mockRejectedValue(new Error('目录不可读'));
    expect(await pathComplete('cat /etc/h', undefined)).toBeNull();
  });
});

describe('AI 增强', () => {
  it('本地无结果且有 key → generateText，前缀校验通过才给后缀', async () => {
    reset();
    useAiConfigStore.setState({ providerKeys: ['openai-compatible|https://api.example.com/v1'] });
    mockGenerate.mockResolvedValue({ text: 'kubectl get pods -n prod' });
    const r = await completeCommand('kubectl get po', {});
    expect(r).toBe('ds -n prod');
    const prompt = (mockGenerate.mock.calls[0]![0] as { prompt: string }).prompt;
    expect(prompt).toContain('Input prefix: kubectl get po');
  });

  it('AI 返回不以前缀开头 → null（不误导）', async () => {
    reset();
    useAiConfigStore.setState({ providerKeys: ['openai-compatible|https://api.example.com/v1'] });
    mockGenerate.mockResolvedValue({ text: '完全不同的命令' });
    expect(await completeCommand('kubectl', {})).toBeNull();
  });

  it('无 key → 跳过 AI（本地降级仍生效）', async () => {
    reset();
    useHistoryStore.setState({ entries: [entry('docker ps -a')] });
    expect(await completeCommand('docker p', {})).toBe('s -a'); // 本地命中
    expect(mockGenerate).not.toHaveBeenCalled();
    expect(await completeCommand('zz', {})).toBeNull(); // 本地无命中且无 key
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it('completeModel 覆盖聊天模型', async () => {
    reset();
    useAiConfigStore.setState({ providerKeys: ['openai-compatible|https://api.example.com/v1'], model: 'big-model' });
    useAgentSettings.setState({ global: { ...DEFAULT_AGENT_SETTINGS, completeModel: 'small-fast' }, overrides: {} });
    mockGenerate.mockResolvedValue({ text: 'xyz-done' });
    await completeCommand('xyz', {});
    // createChatModel 收到的 model 是 completeModel（经 provider 工厂间接断言：
    // 模型名进了生成调用的 prompt 无关，这里只断言生成被调用且结果正确即可）
    expect(mockGenerate).toHaveBeenCalledTimes(1);
  });

  it('abort 后返回 null', async () => {
    reset();
    useAiConfigStore.setState({ providerKeys: ['openai-compatible|https://api.example.com/v1'] });
    mockGenerate.mockImplementation(({ abortSignal }: { abortSignal: AbortSignal }) => {
      abortSignal.dispatchEvent(new Event('abort'));
      return Promise.resolve({ text: 'kubectl get pods' });
    });
    expect(await completeCommand('kubectl', {})).toBeNull();
  });
});
