import { useCallback, useEffect, useRef, useState } from 'react';
import type { SendOptions } from '@features/chat/stores/chat';
import type { AttachmentMeta } from '@features/agent/model/attachments';
import { terminalDebug } from '@features/terminal/services/terminalDebug';

interface UseChatComposerOptions {
  questions: string[];
  draft: string;
  setDraft: (text: string) => void;
  send: (text: string, options?: SendOptions) => Promise<void>;
  sending: boolean;
  isSession: boolean;
  targetPane?: string;
  attachments: AttachmentMeta[];
  clearAttachments: () => void;
  value?: string;
  onTextChange?: (text: string) => void;
  scopeKey?: string;
}

/** Manage composer drafts, question history, keyboard actions and submission. */
export function useChatComposer({
  questions,
  draft,
  setDraft,
  send,
  sending,
  isSession,
  targetPane,
  attachments,
  clearAttachments,
  value,
  onTextChange,
  scopeKey,
}: UseChatComposerOptions) {
  const [localText, setLocalText] = useState('');
  const text = value ?? localText;
  const setText = onTextChange ?? setLocalText;
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const historyRef = useRef<{ index: number; base: string }>({ index: -1, base: '' });

  useEffect(() => {
    if (!draft) return;
    setText(draft);
    setDraft('');
    const element = inputRef.current;
    if (!element) return;
    element.focus();
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 120)}px`;
  }, [draft, setDraft, setText]);

  useEffect(() => {
    historyRef.current = { index: -1, base: '' };
    terminalDebug('chat-composer-scope', { scopeId: scopeKey });
    const element = inputRef.current;
    if (element) {
      element.style.height = 'auto';
      element.style.height = `${Math.min(element.scrollHeight, 120)}px`;
    }
  }, [scopeKey]);

  const resetHistory = useCallback(() => {
    historyRef.current = { index: -1, base: '' };
  }, []);

  const navigateHistory = useCallback((direction: 1 | -1) => {
    const history = historyRef.current;
    const base = history.index === -1 ? text : history.base;
    const candidates = questions.filter((question) =>
      question.startsWith(base) && question.length > base.length,
    );
    const nextIndex = history.index + direction;
    if (nextIndex < -1 || nextIndex >= candidates.length) return false;

    historyRef.current = { index: nextIndex, base };
    setText(nextIndex === -1 ? base : candidates[nextIndex]!);
    const element = inputRef.current;
    if (element) {
      requestAnimationFrame(() => {
        element.selectionStart = element.selectionEnd = element.value.length;
        element.style.height = 'auto';
        element.style.height = `${Math.min(element.scrollHeight, 120)}px`;
      });
    }
    return true;
  }, [questions, text, setText]);

  const submit = useCallback(() => {
    const question = text.trim();
    if ((!question && attachments.length === 0) || sending || !isSession) return;
    terminalDebug('chat-composer-submit', { paneId: targetPane, characters: question.length, attachmentCount: attachments.length });

    setText('');
    resetHistory();
    if (inputRef.current) inputRef.current.style.height = 'auto';
    const payload = attachments.length > 0 ? attachments : undefined;
    clearAttachments();
    void send(question, { paneId: targetPane, attachments: payload });
  }, [attachments, clearAttachments, isSession, resetHistory, send, sending, targetPane, text, setText]);

  const handleChange = useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
    resetHistory();
    setText(event.target.value);
    event.target.style.height = 'auto';
    event.target.style.height = `${Math.min(event.target.scrollHeight, 120)}px`;
  }, [resetHistory, setText]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!text.includes('\n') && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      if (navigateHistory(event.key === 'ArrowUp' ? 1 : -1)) {
        event.preventDefault();
        return;
      }
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
    if (event.key === 'Escape') setText('');
  }, [navigateHistory, submit, text, setText]);

  return {
    text,
    inputRef,
    canSend: (!!text.trim() || attachments.length > 0) && !sending && isSession,
    submit,
    handleChange,
    handleKeyDown,
    navigateHistory,
    resetHistory,
    setText,
  };
}
