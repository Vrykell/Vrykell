import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useChatStore } from '@entities/chat';
import { useBlockStore, useTerminalStore } from '@entities/terminal';
import type { TermBlock } from '@features/terminal/services/pipeline/termBlock';
import { useBlockItemActions } from '@features/terminal/hooks/useBlockItemActions';

const mocks = vi.hoisted(() => ({ ptyWrite: vi.fn(), chatSend: vi.fn() }));
vi.mock('@/platform/pty', () => ({ ptyWrite: mocks.ptyWrite }));

function block(patch: Partial<TermBlock> = {}): TermBlock {
  return {
    id: 'block-1', command: 'git status', status: 'done', exitCode: 0,
    startedAt: 1, endedAt: 2, wasLongRunning: false,
    outputHtml: '', outputText: 'clean', outputRaw: '', linesTruncated: 0,
    ...patch,
  };
}

describe('useBlockItemActions', () => {
  const blockSnapshot = useBlockStore.getState();
  const terminalSnapshot = useTerminalStore.getState();
  const chatSnapshot = useChatStore.getState();

  beforeEach(() => {
    mocks.ptyWrite.mockReset().mockResolvedValue(undefined);
    mocks.chatSend.mockReset();
    useTerminalStore.setState({ sessions: { 'pane-1': 'pty-1' } });
    useChatStore.setState({ send: mocks.chatSend });
  });

  afterEach(() => {
    useBlockStore.setState(blockSnapshot, true);
    useTerminalStore.setState(terminalSnapshot, true);
    useChatStore.setState(chatSnapshot, true);
  });

  it('reruns the block through its pane session and sends a bounded AI explanation', () => {
    const item = block({ outputText: '', outputRaw: 'clean\x1b[31m warning' });
    const { result } = renderHook(() => useBlockItemActions({ tabId: 'pane-1', block: item }));

    act(() => result.current.rerun());
    act(() => result.current.askAI());

    expect(mocks.ptyWrite).toHaveBeenCalledWith('pty-1', 'git status\n');
    expect(mocks.chatSend).toHaveBeenCalledWith(
      '解释:\n```\ngit status\nclean warning\n```',
      { paneId: 'pane-1' },
    );
  });

  it('toggles collapsed state and exposes the derived output fallback', () => {
    const item = block({ collapsed: false, outputText: '', outputRaw: 'plain' });
    useBlockStore.setState({ byTab: { 'pane-1': [item] } });
    const { result } = renderHook(() => useBlockItemActions({ tabId: 'pane-1', block: item }));

    expect(result.current.isCollapsed).toBe(false);
    expect(result.current.copyOutput).toBe('plain');
    act(() => result.current.toggleCollapsed());
    expect(useBlockStore.getState().byTab['pane-1']?.[0]?.collapsed).toBe(true);
  });
});
