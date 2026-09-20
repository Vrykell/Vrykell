import { useCallback, useRef } from 'react';
import type { RefObject } from 'react';
import { useHistoryStore } from '@features/terminal';

interface UseCommandHistoryNavigationOptions {
  text: string;
  setText: (text: string) => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onNavigate?: () => void;
}

/** 管理终端输入框的前缀历史导航，并保留用户翻页前的草稿。 */
export function useCommandHistoryNavigation({
  text,
  setText,
  inputRef,
  onNavigate,
}: UseCommandHistoryNavigationOptions) {
  const navigationRef = useRef<{ index: number; base: string }>({ index: -1, base: '' });

  const reset = useCallback(() => {
    navigationRef.current = { index: -1, base: '' };
  }, []);

  const navigate = useCallback((direction: 1 | -1) => {
    const entries = useHistoryStore.getState().entries;
    const navigation = navigationRef.current;
    const base = navigation.index === -1 ? text : navigation.base;
    const candidates = entries.filter(
      (entry) => entry.command.startsWith(base) && entry.command.length > base.length,
    );
    const nextIndex = navigation.index + direction;
    if (nextIndex < -1 || nextIndex >= candidates.length) return false;

    navigationRef.current = { index: nextIndex, base };
    setText(nextIndex === -1 ? base : candidates[nextIndex]!.command);
    onNavigate?.();

    const element = inputRef.current;
    if (element) {
      requestAnimationFrame(() => {
        element.selectionStart = element.selectionEnd = element.value.length;
      });
    }
    return true;
  }, [inputRef, onNavigate, setText, text]);

  return { reset, navigate };
}
