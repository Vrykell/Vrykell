import { useCallback, useEffect, useRef } from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';
import { writeTerminalCommand } from '../services/commandSubmission';
import { useToastStore } from '@ui/Toast';
import { t } from '@i18n';
import { askAboutTerminal } from '@features/chat/services/conversationContext';
import { useInputStore, useTerminalStore, selectPaneInput } from '@features/terminal';
import { engageFollow } from './useFollowBottom';
import { useCommandHistoryNavigation } from './useCommandHistoryNavigation';
import { useTerminalInputContext } from './useTerminalInputContext';
import { useCommandCompletion } from './useCommandCompletion';
import { usePathCompletion } from './usePathCompletion';
import { appendTerminalBlankLines, setPendingTerminalCommand } from './useTerminalSession';
import { terminalDebug } from '@features/terminal/services/terminalDebug';
import { useAutoSizeTextarea } from '@ui/hooks/useAutoSizeTextarea';
import { acceptsCompletionKey, completionShortcut, useCompletionPreferences } from '@config/completion';

interface UseInputEditorControllerOptions {
  paneId: string;
  focused?: boolean;
  isLongRunning?: boolean;
  runningCommand?: string;
  onEndPress?: () => void;
}

/** The terminal composer submits commands; AI work opens its own conversation composer. */
export function useInputEditorController({ paneId, focused, isLongRunning, onEndPress }: UseInputEditorControllerOptions) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const context = useTerminalInputContext({ paneId, focused, isLongRunning });
  const { sessions, pendingInput, setPendingInput, isFocused, visible, tabCwd } = context;
  const input = useInputStore(selectPaneInput(paneId));
  const text = input.aiMode ? input.commandDraft ?? '' : input.text;
  const setText = useCallback((value: string) => useInputStore.getState().setText(paneId, value), [paneId]);
  useAutoSizeTextarea(inputRef, text, 120, visible);
  useEffect(() => {
    if (!input.focusRequest || !visible || !isFocused) return;
    inputRef.current?.focus();
    const end = inputRef.current?.value.length ?? 0;
    inputRef.current?.setSelectionRange(end, end);
  }, [input.focusRequest, visible, isFocused]);

  useEffect(() => {
    // Restore existing command drafts and move legacy AI drafts into the independent composer.
    if (!input.aiMode) return;
    if (input.text) askAboutTerminal(paneId, undefined, input.text);
    useInputStore.getState().setAiMode(paneId, false);
  }, [input.aiMode, input.text, paneId]);
  useEffect(() => {
    if (!pendingInput) return;
    useInputStore.getState().setAiMode(paneId, false);
    const current = useInputStore.getState().byPane[paneId]?.text ?? '';
    setText(current ? `${current} ${pendingInput}` : pendingInput);
    setPendingInput('');
    inputRef.current?.focus();
  }, [pendingInput, paneId, setPendingInput, setText]);
  const wasVisible = useRef(visible);
  const wasFocused = useRef(isFocused);
  useEffect(() => {
    if (visible && !wasVisible.current) inputRef.current?.focus();
    wasVisible.current = visible;
  }, [visible]);
  useEffect(() => {
    if (isFocused && !wasFocused.current && visible) inputRef.current?.focus();
    wasFocused.current = isFocused;
  }, [isFocused, visible]);
  const resetHeight = useCallback(() => { if (inputRef.current) inputRef.current.style.height = 'auto'; }, []);
  const { acceptPathCompletion, restorePathCompletion, ownsCompletion, isCyclingPathCompletion } = usePathCompletion({ paneId, text, cwd: tabCwd, visible, isFocused, inputRef, setText });
  const { ghost, clearGhost, acceptCompletion, restoreCompletion, isCyclingCompletion } = useCommandCompletion({ text, aiMode: false, isFocused, visible: visible && !ownsCompletion, cwd: tabCwd, inputRef, setText });
  const { reset: resetHistNav, navigate: navHistory } = useCommandHistoryNavigation({ paneId, text, setText, inputRef, onNavigate: clearGhost });

  const execute = useCallback(() => {
    const latest = selectPaneInput(paneId)(useInputStore.getState());
    if (latest.aiMode) return;
    const command = latest.text.trim();
    if (!command && !sessions[paneId]) return;
    useInputStore.getState().clearText(paneId);
    resetHeight(); resetHistNav();
    if (command) setPendingTerminalCommand(paneId, command);
    const sessionId = sessions[paneId];
    terminalDebug('command-submit', { paneId, commandChars: command.length, sessionReady: Boolean(sessionId) });
    if (sessionId) {
      const payload = command || `${latest.text}\n`;
      if (!command) appendTerminalBlankLines(paneId, (payload.match(/\n/g) ?? []).length);
      terminalDebug('pty-write-request', { sessionId, chars: payload.length });
      void writeTerminalCommand(paneId, sessionId, payload)
        .then(() => terminalDebug('pty-write-complete', { sessionId, chars: payload.length }))
        .catch(error => {
          terminalDebug('pty-write-error', { sessionId, errorType: error instanceof Error ? error.name : typeof error });
          if (!useInputStore.getState().byPane[paneId]?.text) useInputStore.getState().setText(paneId, latest.text);
          useToastStore.getState().addToast(t('Could not run the command in the selected terminal'), 'error');
        });
    } else useTerminalStore.getState().queueCommand(paneId, command);
    engageFollow(paneId);
  }, [paneId, sessions, resetHeight, resetHistNav]);

  useEffect(() => {
    if (visible || !onEndPress) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'End' && !event.ctrlKey && !event.metaKey && !event.altKey) onEndPress();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, onEndPress]);
  const handleChange = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
    resetHistNav();
    const value = event.target.value;
    const previous = useInputStore.getState().byPane[paneId]?.text ?? '';
    // Command text never lands in diagnostics: lengths, the delta and the composition flag only.
    terminalDebug('composer-input-change', {
      paneId, chars: value.length, delta: value.length - previous.length,
      composing: Boolean((event.nativeEvent as InputEvent).isComposing),
    });
    setText(value);
  }, [paneId, resetHistNav, setText]);
  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!text.includes('\n') && (event.key === 'ArrowUp' || event.key === 'ArrowDown') && navHistory(event.key === 'ArrowUp' ? 1 : -1)) {
      event.preventDefault(); return;
    }
    const element = event.currentTarget;
    if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.nativeEvent.isComposing && event.keyCode !== 229
      && isCyclingPathCompletion() && acceptPathCompletion(event.shiftKey)) {
      event.preventDefault(); event.stopPropagation(); resetHistNav(); return;
    }
    if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.nativeEvent.isComposing && event.keyCode !== 229
      && (isCyclingCompletion?.() || acceptsCompletionKey(event, useCompletionPreferences.getState().shortcuts, element.selectionStart, element.selectionEnd, text.length))
      && acceptCompletion(event.shiftKey)) {
      event.preventDefault(); event.stopPropagation(); resetHistNav(); return;
    }
    if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.nativeEvent.isComposing && event.keyCode !== 229
      && acceptPathCompletion(event.shiftKey)) {
      event.preventDefault(); event.stopPropagation(); clearGhost(); resetHistNav(); return;
    }
    if (completionShortcut(event) && !event.nativeEvent.isComposing && acceptsCompletionKey(event, useCompletionPreferences.getState().shortcuts,
      element.selectionStart, element.selectionEnd, text.length) && acceptCompletion(event.key === 'Tab' && event.shiftKey)) {
      event.preventDefault(); event.stopPropagation(); resetHistNav(); return;
    }
    if (event.key === 'Escape') {
      if (restorePathCompletion()) { event.preventDefault(); event.stopPropagation(); return; }
      if (restoreCompletion()) return;
      if (ghost) { clearGhost(); return; }
      if (text) { setText(''); resetHeight(); }
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); clearGhost(); execute(); }
  }, [text, navHistory, acceptPathCompletion, restorePathCompletion, isCyclingPathCompletion, acceptCompletion, isCyclingCompletion, resetHistNav, restoreCompletion, ghost, clearGhost, setText, resetHeight, execute]);
  const askAi = useCallback(() => { askAboutTerminal(paneId); }, [paneId]);
  return { ...context, inputRef, panelRef, text, ghost, execute, handleChange, handleKeyDown, askAi };
}
