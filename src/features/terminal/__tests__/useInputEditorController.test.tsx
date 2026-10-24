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
  isCyclingCompletion: vi.fn(),
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
    isCyclingCompletion: mocks.isCyclingCompletion,
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
  it('submits repeat Enter events using the current cleared draft', async () => {
    const { result } = renderHook(() => useInputEditorController({ paneId: 'pane-1' }));
    const execute = result.current.execute;
    await act(async () => { execute(); execute(); execute(); });
    expect(mocks.ptyWrite.mock.calls.map(call => call[1])).toEqual(['git status\n', '\n', '\n']);
  });
  it('preserves a draft consisting of standalone newline characters', () => {
    useInputStore.setState({ byPane: { 'pane-1': { text: '\n\n', aiMode: false } } });
    const { result } = renderHook(() => useInputEditorController({ paneId: 'pane-1' }));
    act(() => result.current.execute());
    expect(mocks.ptyWrite).toHaveBeenCalledWith('pty-1', '\n\n\n');
  });
  it('does not send empty AI messages or enqueue blank input before PTY connection', () => {
    useInputStore.setState({ byPane: { 'pane-1': { text: '', aiMode: true } } });
    const { result } = renderHook(() => useInputEditorController({ paneId: 'pane-1' }));
    act(() => result.current.execute());
    expect(mocks.ptyWrite).toHaveBeenCalledWith('pty-1', '\n');
    expect(mocks.chatSend).not.toHaveBeenCalled();
    mocks.ptyWrite.mockClear();
    mocks.sessions = {};
    act(() => useInputStore.setState({ byPane: { 'pane-1': { text: '', aiMode: false } } }));
    act(() => result.current.execute());
    expect(mocks.ptyWrite).not.toHaveBeenCalled();
    expect(useTerminalStore.getState().pendingCommands['pane-1']).toBeUndefined();
  });

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
    mocks.isCyclingCompletion.mockReset().mockReturnValue(false);
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

  it('submits a multiline script as one shell statement without losing its source draft', async () => {
    const script = "cat <<'TEXT'\nline with 'quotes'\nTEXT\nprintf done";
    useInputStore.getState().setText('pane-1', script);
    const { result } = renderHook(() => useInputEditorController({ paneId: 'pane-1' }));
    await act(async () => result.current.execute());
    const payload = mocks.ptyWrite.mock.calls[0]![1] as string;
    expect(payload.trimEnd()).not.toContain('\n');
    expect(payload).toContain('eval "$(printf');
    expect(payload).toContain("line with '\\''quotes'\\''");
  });

  it('restores the script draft if the terminal write fails', async () => {
    mocks.ptyWrite.mockRejectedValueOnce(new Error('closed'));
    const { result } = renderHook(() => useInputEditorController({ paneId: 'pane-1' }));
    await act(async () => result.current.execute());
    expect(useInputStore.getState().byPane['pane-1']?.text).toBe('git status');
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

  it('keeps an accepted command cycle from being reinterpreted as filesystem completion', () => {
    mocks.isCyclingCompletion.mockReturnValue(true); mocks.acceptCompletion.mockReturnValue(true);
    const { result } = renderHook(() => useInputEditorController({ paneId: 'pane-1' }));
    const preventDefault = vi.fn(); const stopPropagation = vi.fn();
    act(() => result.current.handleKeyDown({ key: 'Tab', shiftKey: true, preventDefault, stopPropagation,
      nativeEvent: { isComposing: false } } as unknown as React.KeyboardEvent<HTMLTextAreaElement>));
    expect(mocks.acceptCompletion).toHaveBeenCalledWith(true); expect(preventDefault).toHaveBeenCalledOnce();
    expect(mocks.clearGhost).not.toHaveBeenCalled(); expect(mocks.ptyWrite).not.toHaveBeenCalled();
  });

  it('keeps an AI draft out of the PTY when the chat panel opens', () => {
    useInputStore.setState({ byPane: { 'pane-1': { text: '解释这个项目', aiMode: true } } });
    const { result } = renderHook(() => useInputEditorController({ paneId: 'pane-1' }));
    act(() => useDockStore.setState({ rightPanels: ['chat'] }));
    expect(useInputStore.getState().byPane['pane-1']?.aiMode).toBe(false);
    expect(result.current.text).toBe('');
    act(() => result.current.execute());
    expect(mocks.ptyWrite).toHaveBeenCalledWith('pty-1', '\n');
    expect(useInputStore.getState().byPane['pane-1']?.aiDraft).toBe('解释这个项目');
    act(() => useDockStore.setState({ rightPanels: [] }));
    act(() => result.current.askAi());
    expect(result.current.text).toBe('');
  });

  it('restores the command draft instead of submitting the AI draft', () => {
    useInputStore.setState({ byPane: { 'pane-1': { text: '解释这个项目', aiMode: true, commandDraft: 'git status' } } });
    const { result } = renderHook(() => useInputEditorController({ paneId: 'pane-1' }));
    act(() => useDockStore.setState({ rightPanels: ['chat'] }));
    expect(result.current.text).toBe('git status');
    act(() => result.current.execute());
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
