import { useCallback, useRef } from 'react';
import type { RefObject } from 'react';
import { useBlockStore } from '@features/terminal';

interface UseCommandHistoryNavigationOptions {
  paneId: string;
  text: string;
  setText: (text: string) => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onNavigate?: () => void;
}

/** Unique commands executed in this pane, newest first: navigation follows one terminal, not the app. */
function paneCommands(paneId: string): string[] {
  const blocks = useBlockStore.getState().byTab[paneId] ?? [];
  const seen = new Set<string>();
  const commands: string[] = [];
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const command = blocks[index]!.command;
    if (!command.trim() || seen.has(command)) continue;
    seen.add(command);
    commands.push(command);
  }
  return commands;
}

/** Navigate one terminal pane's command history by prefix, keeping the draft typed before paging. */
export function useCommandHistoryNavigation({
  paneId,
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
    const commands = paneCommands(paneId);
    const navigation = navigationRef.current;
    const base = navigation.index === -1 ? text : navigation.base;
    const candidates = commands.filter(
      (command) => command.startsWith(base) && command.length > base.length,
    );
    const nextIndex = navigation.index + direction;
    if (nextIndex < -1 || nextIndex >= candidates.length) return false;

    navigationRef.current = { index: nextIndex, base };
    setText(nextIndex === -1 ? base : candidates[nextIndex]!);
    onNavigate?.();

    const element = inputRef.current;
    if (element) {
      requestAnimationFrame(() => {
        element.selectionStart = element.selectionEnd = element.value.length;
      });
    }
    return true;
  }, [inputRef, onNavigate, paneId, setText, text]);

  return { reset, navigate };
}
