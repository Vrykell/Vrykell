import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useAgentSettings } from '@features/agent';
import { completeCommand, localCompleteCandidates } from '@features/agent/services/complete';

export interface CompletionCycle {
  base: string;
  candidates: string[];
  index: number;
}

interface UseCommandCompletionOptions {
  text: string;
  aiMode: boolean;
  isFocused: boolean;
  visible: boolean;
  cwd?: string;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  setText: (text: string) => void;
}

/** Keep full suggestions stable while editing their prefix; accept, cycle and restore separately. */
export function useCommandCompletion({
  text,
  aiMode,
  isFocused,
  visible,
  cwd,
  inputRef,
  setText,
}: UseCommandCompletionOptions) {
  const completeOn = useAgentSettings((state) => state.global.completeEnabled);
  const completeDebounceMs = useAgentSettings((state) => state.global.completeDebounceMs);
  const [suggestions, setSuggestions] = useState<{ commands: string[]; cwd?: string }>({ commands: [] });
  const enabled = completeOn && !aiMode && isFocused && visible && text.trim().length > 0 && !text.includes('\n');
  const ghostCandidates = enabled && suggestions.cwd === cwd
    ? suggestions.commands.filter(command => command.length > text.length && command.startsWith(text)).map(command => command.slice(text.length))
    : [];
  const ghost = ghostCandidates[0] ?? '';
  const completionRef = useRef<CompletionCycle | null>(null);
  const sequenceRef = useRef(0);
  const suppressEffectRef = useRef(false);

  const clearGhost = useCallback(() => {
    sequenceRef.current++;
    completionRef.current = null;
    setSuggestions({ commands: [] });
  }, []);

  useEffect(() => {
    if (suppressEffectRef.current) {
      suppressEffectRef.current = false;
      return;
    }
    completionRef.current = null;
    const sequence = ++sequenceRef.current;
    if (!enabled) {
      setSuggestions({ commands: [] });
      return;
    }

    const locals = localCompleteCandidates(text);
    if (locals.length > 0) {
      setSuggestions({ commands: locals.map(suffix => text + suffix), cwd });
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      completeCommand(text, { cwd }, controller.signal)
        .then((suffix) => {
          if (suffix && sequence === sequenceRef.current && !controller.signal.aborted) {
            setSuggestions({ commands: [text + suffix], cwd });
          }
        })
        .catch(() => {});
    }, completeDebounceMs);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [completeDebounceMs, cwd, enabled, text]);

  const acceptCompletion = useCallback((shiftKey: boolean) => {
    if (ghostCandidates.length === 0 && !completionRef.current) return false;
    const cycle = completionRef.current;
    if (cycle) {
      const direction = shiftKey ? -1 : 1;
      cycle.index = (cycle.index + direction + cycle.candidates.length) % cycle.candidates.length;
      suppressEffectRef.current = true;
      setText(cycle.base + cycle.candidates[cycle.index]!);
    } else {
      completionRef.current = { base: text, candidates: ghostCandidates, index: 0 };
      suppressEffectRef.current = true;
      setText(text + ghostCandidates[0]!);
      setSuggestions({ commands: [] });
    }

    const element = inputRef.current;
    if (element) {
      element.style.height = 'auto';
      requestAnimationFrame(() => {
        element.style.height = Math.min(element.scrollHeight, 120) + 'px';
      });
    }
    return true;
  }, [ghostCandidates, inputRef, setText, text]);

  const restoreCompletion = useCallback(() => {
    const cycle = completionRef.current;
    if (!cycle) return false;
    suppressEffectRef.current = true;
    setText(cycle.base);
    clearGhost();
    return true;
  }, [clearGhost, setText]);

  return {
    isCyclingCompletion: () => completionRef.current !== null,
    ghost,
    ghostCandidates,
    clearGhost,
    acceptCompletion,
    restoreCompletion,
  };
}
