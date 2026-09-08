/**
 * title（M7）测试：触发算法 —— 充分性（≥3 done 块或 ≥50 字首轮回答）、
 * 手动命名保护、titleAuto 覆盖、60s 冷却、无 key 跳过、开关、sanitize。
 * 模块级 mock 'ai'（generateText）+ '@tauri-apps/api/core'；不用 beforeEach
 * （本仓库 vitest 4 陷阱，见 files.test.ts 头注释），各用例开头调 reset()。
 */
import { describe, expect, it, vi } from 'vitest';

const { mockGenerate } = vi.hoisted(() => ({ mockGenerate: vi.fn() }));
vi.mock('ai', () => ({ generateText: mockGenerate }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

import { DEFAULT_AGENT_SETTINGS, useAgentSettings } from '@/features/agent/agentSettings';
import { maybeAutoTitle, resetTitleState, sanitizeTitle } from '@/features/agent/title';
import { useAiConfigStore } from '@/services/tauri/ai';
import { leaf } from '@/services/tauri/windowLayout';
import { useBlockStore } from '@/store/blocks';
import { useChatStore } from '@/store/chat';
import { useWorkspaceStore } from '@/store/workspace';

function mkTab(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    title: '新会话',
    kind: 'session' as const,
    layout: leaf({ id: `${id}#0`, kind: 'local' as const }),
    ...extra,
  };
}

function reset() {
  resetTitleState();
  mockGenerate.mockReset();
  mockGenerate.mockResolvedValue({ text: '「Rust 学习笔记」。\n' });
  useAgentSettings.setState({
    global: { ...DEFAULT_AGENT_SETTINGS, autoTitle: true, titleModel: '' },
    overrides: {},
  });
  useAiConfigStore.setState({
    hasKey: true,
    provider: 'openai-compatible',
    baseUrl: 'https://api.example.com/v1',
    model: 'gpt-4o-mini',
  });
  useBlockStore.setState({ byTab: {} });
  useChatStore.setState({ byTab: {} });
  useWorkspaceStore.setState({ tabs: [mkTab('t1')], activeId: 't1' });
}

const doneBlock = (id: string, command: string) =>
  ({ id, command, status: 'done' as const }) as never;

function setThreeDoneBlocks(tabId: string) {
  useBlockStore.setState({
    byTab: {
      [tabId]: [
        doneBlock('b1', 'git status'),
        doneBlock('b2', 'cargo test'),
        doneBlock('b3', 'git push'),
      ],
    },
  });
}

describe('智能标题触发', () => {
  it('信息不足（<3 done 块且无长回答）→ 不生成', async () => {
    reset();
    useBlockStore.setState({ byTab: { t1: [doneBlock('b1', 'ls')] } });
    expect(await maybeAutoTitle('t1')).toBe(false);
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it('≥3 done 块 → 生成并落标题（sanitize 去引号尾标点）', async () => {
    reset();
    setThreeDoneBlocks('t1');
    expect(await maybeAutoTitle('t1')).toBe(true);
    const tab = useWorkspaceStore.getState().tabs[0]!;
    expect(tab.title).toBe('Rust 学习笔记');
    expect(tab.named).toBe(true);
    expect(tab.titleAuto).toBe(true);
  });

  it('首轮 AI 回答 ≥50 字也触发（无命令块）', async () => {
    reset();
    useChatStore.setState({
      byTab: {
        t1: [
          { id: 'm1', role: 'user', content: '讲讲 Rust 生命周期', createdAt: 1 },
          { id: 'm2', role: 'assistant', content: 'x'.repeat(60), pending: false, createdAt: 2 },
        ],
      },
    });
    expect(await maybeAutoTitle('t1')).toBe(true);
    expect(mockGenerate).toHaveBeenCalledTimes(1);
    const prompt = (mockGenerate.mock.calls[0]![0] as { prompt: string }).prompt;
    expect(prompt).toContain('讲讲 Rust 生命周期');
  });

  it('手动命名的标签不被覆盖', async () => {
    reset();
    useWorkspaceStore.setState({
      tabs: [mkTab('t1', { title: '我的窗口', named: true })],
      activeId: 't1',
    });
    setThreeDoneBlocks('t1');
    expect(await maybeAutoTitle('t1')).toBe(false);
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it('截断兜底命名的标签（titleAuto）可被 AI 标题升级', async () => {
    reset();
    useWorkspaceStore.setState({
      tabs: [mkTab('t1', { title: 'git status', named: true, titleAuto: true })],
      activeId: 't1',
    });
    setThreeDoneBlocks('t1');
    expect(await maybeAutoTitle('t1')).toBe(true);
    expect(useWorkspaceStore.getState().tabs[0]!.title).toBe('Rust 学习笔记');
  });

  it('冷却：60s 内第二次尝试直接跳过', async () => {
    reset();
    setThreeDoneBlocks('t1');
    expect(await maybeAutoTitle('t1', 100_000)).toBe(true);
    // 同一 tab 立即再来 → 冷却拦截
    expect(await maybeAutoTitle('t1', 100_001)).toBe(false);
    expect(mockGenerate).toHaveBeenCalledTimes(1);
    // 61s 后放行
    expect(await maybeAutoTitle('t1', 161_001)).toBe(true);
    expect(mockGenerate).toHaveBeenCalledTimes(2);
  });

  it('开关关闭 → 不生成', async () => {
    reset();
    useAgentSettings.setState({
      global: { ...DEFAULT_AGENT_SETTINGS, autoTitle: false },
      overrides: {},
    });
    setThreeDoneBlocks('t1');
    expect(await maybeAutoTitle('t1')).toBe(false);
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it('无 key → 启发式总结（首个提问首行）', async () => {
    reset();
    useAiConfigStore.setState({ hasKey: false });
    setThreeDoneBlocks('t1');
    useChatStore.setState({
      byTab: {
        t1: [
          { id: 'u1', role: 'user', content: '帮我看看这个报错', createdAt: 1 },
          { id: 'a1', role: 'assistant', content: 'x'.repeat(60), createdAt: 2 },
        ],
      },
    });
    expect(await maybeAutoTitle('t1')).toBe(true);
    expect(mockGenerate).not.toHaveBeenCalled();
    const tab = useWorkspaceStore.getState().tabs.find((t) => t.id === 't1');
    expect(tab?.title).toContain('帮我看看这个报错');
  });

  it('generateText 失败 → false 不抛出，冷却仍计时', async () => {
    reset();
    setThreeDoneBlocks('t1');
    mockGenerate.mockRejectedValue(new Error('网络错误'));
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await maybeAutoTitle('t1')).toBe(false);
    spy.mockRestore();
  });
});

describe('sanitizeTitle', () => {
  it('去引号/换行/尾标点，限长 16 字', () => {
    expect(sanitizeTitle('  「标题」。\n')).toBe('标题');
    expect(sanitizeTitle('a'.repeat(30))).toBe('a'.repeat(16));
    expect(sanitizeTitle('"\n')).toBe('');
  });
});
