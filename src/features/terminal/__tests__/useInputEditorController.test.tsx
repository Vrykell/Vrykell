import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useChatStore } from '@features/chat';
import { useSessionStore } from '@features/workspace';
import { useInputStore, useTerminalStore } from '@features/terminal';
import { useDockStore } from '@features/workspace';
import { useInputEditorController } from '@features/terminal/hooks/useInputEditorController';

const mocks = vi.hoisted(() => ({
  ptyWrite: vi.fn(),
  engageFollow: vi.fn(),
  resetHistory: vi.fn(),
  navigateHistory: vi.fn(),
  clearGhost: vi.fn(),
  acceptCompletion: vi.fn(),
  restoreCompletion: vi.fn(),
  addPastedText: vi.fn(),
  addBlobs: vi.fn(),
  pickFiles: vi.fn(),
  togglePreview: vi.fn(),
  removeAttachment: vi.fn(),
  clearAttachments: vi.fn(),
  chatSend: vi.fn(),
  sessions: { 'pane-1': 'pty-1' } as Record<string, string>,
}));

vi.mock('@platform/pty', () => ({ ptyWrite: mocks.ptyWrite }));
vi.mock('@features/terminal/hooks/useFollowBottom', () => ({ engageFollow: mocks.engageFollow }));
vi.mock('@features/terminal/hooks/useTerminalInputContext', () => ({
  useTerminalInputContext: () => ({
    sessions: mocks.sessions,
    isFocused: true,
    hasSession: Boolean(mocks.sessions['pane-1']),
    pendingInput: '',
    setPendingInput: vi.fn(),
    tabCwd: 'C:/workspace',
    terminalLabel: 'Bash',
    recentGitBranch: null,
    visible: true,
  }),
}));
vi.mock('@features/terminal/hooks/useCommandCompletion', () => ({
  useCommandCompletion: () => ({
    ghost: '',
    clearGhost: mocks.clearGhost,
    acceptCompletion: mocks.acceptCompletion,
    restoreCompletion: mocks.restoreCompletion,
  }),
}));
vi.mock('@features/terminal/hooks/useCommandHistoryNavigation', () => ({
  useCommandHistoryNavigation: () => ({ reset: mocks.resetHistory, navigate: mocks.navigateHistory }),
}));
vi.mock('@features/agent', () => ({
  usePermissions: (selector: (state: { mode: string; setMode: () => void }) => unknown) =>
    selector({ mode: 'standard', setMode: vi.fn() }),
  useAttachmentComposer: () => ({
    attachments: [],
    previewId: null,
    panelRef: { current: null },
    addPastedText: mocks.addPastedText,
    pickFiles: mocks.pickFiles,
    addBlobs: mocks.addBlobs,
    togglePreview: mocks.togglePreview,
    removeAttachment: mocks.removeAttachment,
    clearAttachments: mocks.clearAttachments,
  }),
}));

describe('useInputEditorController', () => {
  const inputSnapshot = useInputStore.getState();
  const chatSnapshot = useChatStore.getState();
  const sessionSnapshot = useSessionStore.getState();
  const dockSnapshot = useDockStore.getState();
  const terminalSnapshot = useTerminalStore.getState();

  beforeEach(() => {
    mocks.ptyWrite.mockReset().mockResolvedValue(undefined);
    mocks.chatSend.mockReset();
    mocks.engageFollow.mockReset();
    mocks.resetHistory.mockReset();
    mocks.navigateHistory.mockReset().mockReturnValue(false);
    mocks.clearGhost.mockReset();
    mocks.acceptCompletion.mockReset().mockReturnValue(false);
    mocks.restoreCompletion.mockReset().mockReturnValue(false);
    mocks.clearAttachments.mockReset();
    mocks.sessions = { 'pane-1': 'pty-1' };
    useInputStore.setState({ byPane: { 'pane-1': { text: 'git status', aiMode: false } } });
    useChatStore.setState({ sendingTab: null, send: mocks.chatSend });
    useSessionStore.setState({ activeId: 'tab-1' });
    useDockStore.setState({ leftPanels: [], rightPanels: [] });
  });

  afterEach(() => {
    useInputStore.setState(inputSnapshot, true);
    useChatStore.setState(chatSnapshot, true);
    useSessionStore.setState(sessionSnapshot, true);
    useDockStore.setState(dockSnapshot, true);
    useTerminalStore.setState(terminalSnapshot, true);
  });

  it('submits command text through the pane PTY and engages follow-bottom', () => {
    const { result } = renderHook(() => useInputEditorController({ paneId: 'pane-1' }));

    act(() => result.current.execute());

    expect(mocks.ptyWrite).toHaveBeenCalledWith('pty-1', 'git status\n');
    expect(mocks.engageFollow).toHaveBeenCalledWith('pane-1');
    expect(useInputStore.getState().byPane['pane-1']?.text).toBe('');
  });

  it('routes Enter to the same command submission controller', () => {
    const { result } = renderHook(() => useInputEditorController({ paneId: 'pane-1' }));
    const preventDefault = vi.fn();

    act(() => result.current.handleKeyDown({
      key: 'Enter', shiftKey: false, preventDefault,
      nativeEvent: { isComposing: false },
    } as unknown as React.KeyboardEvent<HTMLTextAreaElement>));

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(mocks.ptyWrite).toHaveBeenCalledWith('pty-1', 'git status\n');
  });

  it('queues a command entered before the PTY is ready and flushes it on session attach', () => {
    mocks.sessions = {};
    useTerminalStore.setState({ sessions: {}, pendingCommands: {} });
    const { result } = renderHook(() => useInputEditorController({ paneId: 'pane-1' }));

    act(() => result.current.execute());

    expect(mocks.ptyWrite).not.toHaveBeenCalled();
    expect(useTerminalStore.getState().pendingCommands['pane-1']).toEqual(['git status']);

    act(() => useTerminalStore.getState().setSession('pane-1', 'pty-1'));

    expect(mocks.ptyWrite).toHaveBeenCalledWith('pty-1', 'git status\n');
    expect(useTerminalStore.getState().pendingCommands['pane-1']).toBeUndefined();
  });
});
