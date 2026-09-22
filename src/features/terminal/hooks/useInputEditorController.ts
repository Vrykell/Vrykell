import { useCallback, useEffect, useRef } from 'react';
import type { ChangeEvent, ClipboardEvent, KeyboardEvent } from 'react';
import { ptyWrite } from '@platform/pty';
import { useChatStore } from '@features/chat';
import { useSessionStore } from '@features/workspace';
import { useInputStore, useTerminalStore, selectPaneInput } from '@features/terminal';
import { usePermissions, useAttachmentComposer } from '@features/agent';
import { useDockStore } from '@features/workspace';
import { engageFollow } from '@features/terminal/hooks/useFollowBottom';
import { useCommandHistoryNavigation } from '@features/terminal/hooks/useCommandHistoryNavigation';
import { useTerminalInputContext } from '@features/terminal/hooks/useTerminalInputContext';
import { useCommandCompletion } from '@features/terminal/hooks/useCommandCompletion';

interface UseInputEditorControllerOptions {
  paneId: string;
  focused?: boolean;
  isLongRunning?: boolean;
  runningCommand?: string;
  onEndPress?: () => void;
}

/**
 * 输入栏的行为控制器。
 *
 * 将 pane 输入状态、AI/命令提交、补全、历史导航、粘贴和焦点生命周期
 * 组合在同一个领域 Hook 中，让 InputEditor 只负责渲染交互表面。
 */
export function useInputEditorController({
  paneId,
  focused,
  isLongRunning,
  onEndPress,
}: UseInputEditorControllerOptions) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const chatSend = useChatStore((state) => state.send);
  const {
    sessions,
    isFocused,
    hasSession,
    pendingInput,
    setPendingInput,
    tabCwd,
    terminalLabel,
    recentGitBranch,
    visible,
  } = useTerminalInputContext({ paneId, focused, isLongRunning });

  const input = useInputStore(selectPaneInput(paneId));
  const text = input.text;
  const aiMode = input.aiMode;
  const setText = useCallback((value: string) => {
    useInputStore.getState().setText(paneId, value);
  }, [paneId]);
  const setAiMode = useCallback((value: boolean) => {
    useInputStore.getState().setAiMode(paneId, value);
  }, [paneId]);

  const sendingTab = useChatStore((state) => state.sendingTab);
  const abortStream = useChatStore((state) => state.abortStream);
  const activeId = useSessionStore((state) => state.activeId);
  const sendingHere = sendingTab !== null && sendingTab === activeId;
  const permMode = usePermissions((state) => state.mode);
  const setPermMode = usePermissions((state) => state.setMode);
  const {
    attachments: atts,
    previewId,
    panelRef,
    addPastedText,
    pickFiles,
    addBlobs,
    togglePreview,
    removeAttachment,
    clearAttachments,
  } = useAttachmentComposer();
  const chatOpen = useDockStore((state) => state.leftPanels.includes('chat') || state.rightPanels.includes('chat'));
  const canSendAi = (!!text.trim() || atts.length > 0) && !sendingTab;

  useEffect(() => {
    if (pendingInput) {
      setText(text ? text + ' ' + pendingInput : pendingInput);
      setAiMode(false);
      setPendingInput('');
      inputRef.current?.focus();
    }
    // pendingInput 是一次性事件，避免 text/paneId 变化重复消费。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingInput, setPendingInput, setText, setAiMode]);

  const wasVisibleRef = useRef(visible);
  useEffect(() => {
    if (visible && !wasVisibleRef.current) inputRef.current?.focus();
    wasVisibleRef.current = visible;
  }, [visible]);

  const wasFocusedRef = useRef(isFocused);
  useEffect(() => {
    if (isFocused && !wasFocusedRef.current && visible) inputRef.current?.focus();
    wasFocusedRef.current = isFocused;
  }, [isFocused, visible]);

  const resetHeight = useCallback(() => {
    if (inputRef.current) inputRef.current.style.height = 'auto';
  }, []);

  const { ghost, clearGhost, acceptCompletion, restoreCompletion } = useCommandCompletion({
    text,
    aiMode,
    isFocused,
    visible,
    cwd: tabCwd,
    inputRef,
    setText,
  });
  const { reset: resetHistNav, navigate: navHistory } = useCommandHistoryNavigation({
    text,
    setText,
    inputRef,
    onNavigate: clearGhost,
  });

  useEffect(() => {
    if (chatOpen && aiMode) setAiMode(false);
  }, [chatOpen, aiMode, setAiMode]);

  const execute = useCallback(() => {
    const command = text.trim();
    if (aiMode ? (!command && atts.length === 0) || sendingTab : !command) return;
    useInputStore.getState().clearText(paneId);
    resetHeight();
    resetHistNav();
    try {
      if (aiMode) {
        chatSend(command, { paneId, attachments: atts.length > 0 ? atts : undefined });
        clearAttachments();
      } else {
        const sessionId = sessions[paneId];
        if (sessionId) {
          ptyWrite(sessionId, command.endsWith('\n') ? command : command + '\n').catch(() => {});
        } else {
          // Windows shell 探测/启动可能晚于输入栏，不能在 sessionId 返回前静默丢掉命令。
          useTerminalStore.getState().queueCommand(paneId, command);
        }
        engageFollow(paneId);
      }
    } catch (error) {
      console.error('[InputEditor] execute failed:', error);
    }
  }, [text, aiMode, atts, sendingTab, chatSend, paneId, sessions, resetHeight, resetHistNav, clearAttachments]);

  useEffect(() => {
    if (!visible && onEndPress) {
      const onKey = (event: globalThis.KeyboardEvent) => {
        if (event.key === 'End' && !event.ctrlKey && !event.metaKey && !event.altKey) onEndPress();
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }
  }, [visible, onEndPress]);

  const handleChange = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
    resetHistNav();
    setText(event.target.value);
    event.target.style.height = 'auto';
    event.target.style.height = Math.min(event.target.scrollHeight, 120) + 'px';
  }, [resetHistNav, setText]);

  const handlePaste = useCallback((event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (!aiMode) return;
    const files = Array.from(event.clipboardData.files);
    if (files.length > 0) {
      event.preventDefault();
      void addBlobs(files);
      return;
    }
    const pastedText = event.clipboardData.getData('text/plain');
    if (pastedText && addPastedText(pastedText)) event.preventDefault();
  }, [addBlobs, addPastedText, aiMode]);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!aiMode && !text.includes('\n') && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      if (navHistory(event.key === 'ArrowUp' ? 1 : -1)) {
        event.preventDefault();
        return;
      }
    }
    if (event.key === 'Tab' && acceptCompletion(event.shiftKey)) {
      event.preventDefault();
      resetHistNav();
      return;
    }
    if (event.key === 'Escape') {
      if (restoreCompletion()) return;
      if (ghost) {
        clearGhost();
        return;
      }
      if (text) {
        setText('');
        resetHeight();
      } else if (aiMode && !chatOpen) {
        setAiMode(false);
      }
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      clearGhost();
      execute();
    }
  }, [acceptCompletion, aiMode, chatOpen, clearGhost, execute, ghost, navHistory, resetHeight, resetHistNav, restoreCompletion, setAiMode, setText, text]);

  const toggleAiMode = useCallback(() => {
    if (!chatOpen) setAiMode(!aiMode);
  }, [aiMode, chatOpen, setAiMode]);

  return {
    inputRef,
    text,
    aiMode,
    setAiMode,
    toggleAiMode,
    isFocused,
    hasSession,
    sessions,
    tabCwd,
    terminalLabel,
    recentGitBranch,
    visible,
    chatOpen,
    sendingHere,
    activeId,
    abortStream,
    permMode,
    setPermMode,
    atts,
    previewId,
    panelRef,
    pickFiles,
    addBlobs,
    togglePreview,
    removeAttachment,
    canSendAi,
    ghost,
    execute,
    handleChange,
    handlePaste,
    handleKeyDown,
  };
}
