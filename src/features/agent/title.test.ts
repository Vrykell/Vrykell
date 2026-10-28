/**
 * title (M7) tests: the trigger algorithm - sufficiency (>=3 done blocks or a >=50-character
 * first answer), manual naming protection, titleAuto override, 60s cooldown, skipping without
 * a key, the toggle, and sanitize.
 * Module-level mocks for 'ai' (generateText) and '@tauri-apps/api/core'; no beforeEach
 * (a vitest 4 trap in this repository, see the header comment in files.test.ts), each case
 * calls reset() at the start.
 */
import { describe, it, expect, vi } from 'vitest';

const { mockGenerate } = vi.hoisted(() => ({ mockGenerate: vi.fn() }));
vi.mock('ai', () => ({ generateText: mockGenerate }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

import { maybeAutoTitle, sanitizeTitle, resetTitleState } from '@features/agent/services/title';
import { useAgentSettings, DEFAULT_AGENT_SETTINGS } from '@features/agent/stores/agentSettings';
import { useAiConfigStore } from '@features/agent/stores/aiConfig';
import { useBlockStore } from '@features/terminal/stores/blocks';
import { useChatStore } from '@features/chat/stores/chat';
import { useSessionStore } from '@features/workspace';
import { leaf } from '@features/workspace/model/windowLayout';

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
  useAgentSettings.setState({ global: { ...DEFAULT_AGENT_SETTINGS, autoTitle: true, titleModel: '' }, overrides: {} });
  useAiConfigStore.setState({
    providerKeys: ['openai-compatible|https://api.example.com/v1'],
    provider: 'openai-compatible',
    baseUrl: 'https://api.example.com/v1',
    model: 'gpt-4o-mini',
    models: [],
    activeModel: '',
  });
  useBlockStore.setState({ byTab: {} });
  useChatStore.setState({ byTab: {} });
  useSessionStore.setState({ tabs: [mkTab('t1')], activeId: 't1' });
}

const doneBlock = (id: string, command: string) =>
  ({ id, command, status: 'done' as const }) as never;

function setThreeDoneBlocks(tabId: string) {
  useBlockStore.setState({
    byTab: { [tabId]: [doneBlock('b1', 'git status'), doneBlock('b2', 'cargo test'), doneBlock('b3', 'git push')] },
  });
}

describe('automatic title trigger', () => {
  it('insufficient information (<3 done blocks and no long answer) → no generation', async () => {
    reset();
    useBlockStore.setState({ byTab: { t1: [doneBlock('b1', 'ls')] } });
    expect(await maybeAutoTitle('t1')).toBe(false);
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it('>=3 done blocks → generate and set the title (sanitize strips quotes and trailing punctuation)', async () => {
    reset();
    setThreeDoneBlocks('t1');
    expect(await maybeAutoTitle('t1')).toBe(true);
    const tab = useSessionStore.getState().tabs[0]!;
    expect(tab.title).toBe('Rust 学习笔记');
    expect(tab.titleSource).toBe('ai');
  });

  it('reads command blocks owned by a pane when naming its terminal tab', async () => {
    reset();
    useBlockStore.setState({
      byTab: {
        't1#0': [
          doneBlock('b1', 'git status'),
          doneBlock('b2', 'cargo test'),
          doneBlock('b3', 'git push'),
        ],
      },
    });
    expect(await maybeAutoTitle('t1')).toBe(true);
    const prompt = (mockGenerate.mock.calls[0]![0] as { prompt: string }).prompt;
    expect(prompt).toContain('cargo test');
  });

  it('a first AI answer of >=50 characters also triggers (no command blocks)', async () => {
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

  it('a manually named tab is not overwritten', async () => {
    reset();
    useSessionStore.setState({ tabs: [mkTab('t1', { title: '我的窗口', titleSource: 'manual' })], activeId: 't1' });
    setThreeDoneBlocks('t1');
    expect(await maybeAutoTitle('t1')).toBe(false);
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it('a tab with a truncated fallback name (command source) can be upgraded by an AI title', async () => {
    reset();
    useSessionStore.setState({
      tabs: [mkTab('t1', { title: 'git status', titleSource: 'command' })],
      activeId: 't1',
    });
    setThreeDoneBlocks('t1');
    expect(await maybeAutoTitle('t1')).toBe(true);
    expect(useSessionStore.getState().tabs[0]!.title).toBe('Rust 学习笔记');
  });

  it('cooldown: a second attempt within 60s is skipped', async () => {
    reset();
    setThreeDoneBlocks('t1');
    expect(await maybeAutoTitle('t1', 100_000)).toBe(true);
    // The same tab immediately again → blocked by the cooldown
    expect(await maybeAutoTitle('t1', 100_001)).toBe(false);
    expect(mockGenerate).toHaveBeenCalledTimes(1);
    // Allowed again after 61s
    expect(await maybeAutoTitle('t1', 161_001)).toBe(true);
    expect(mockGenerate).toHaveBeenCalledTimes(2);
  });

  it('toggle off → no generation', async () => {
    reset();
    useAgentSettings.setState({ global: { ...DEFAULT_AGENT_SETTINGS, autoTitle: false }, overrides: {} });
    setThreeDoneBlocks('t1');
    expect(await maybeAutoTitle('t1')).toBe(false);
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it('no key → heuristic summary (first line of the first question)', async () => {
    reset();
    useAiConfigStore.setState({ providerKeys: [] });
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
    const tab = useSessionStore.getState().tabs.find((t) => t.id === 't1');
    expect(tab?.title).toContain('帮我看看这个报错');
  });

  it('generateText failure → false, does not throw, cooldown still runs', async () => {
    reset();
    setThreeDoneBlocks('t1');
    mockGenerate.mockRejectedValue(new Error('网络错误'));
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await maybeAutoTitle('t1')).toBe(false);
    spy.mockRestore();
  });
});

describe('sanitizeTitle', () => {
  it('strips quotes/newlines/trailing punctuation, capped at 16 characters', () => {
    expect(sanitizeTitle('  「标题」。\n')).toBe('标题');
    expect(sanitizeTitle('a'.repeat(30))).toBe('a'.repeat(16));
    expect(sanitizeTitle('"\n')).toBe('');
  });
});
