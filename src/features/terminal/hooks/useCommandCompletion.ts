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

/** 管理命令补全的异步建议、候选循环和 Esc 恢复，隔离输入栏的补全状态机。 */
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
  const [ghost, setGhost] = useState('');
  const [ghostCandidates, setGhostCandidates] = useState<string[]>([]);
  const completionRef = useRef<CompletionCycle | null>(null);
  const sequenceRef = useRef(0);
  const suppressEffectRef = useRef(false);

  const clearGhost = useCallback(() => {
    sequenceRef.current++;
    completionRef.current = null;
    setGhost('');
    setGhostCandidates([]);
  }, []);

  useEffect(() => {
    if (suppressEffectRef.current) {
      suppressEffectRef.current = false;
      return;
    }
    completionRef.current = null;
    setGhost('');
    setGhostCandidates([]);
    if (!completeOn || aiMode || !isFocused || !visible || text.trim().length < 1 || text.includes('\n')) return;

    const locals = localCompleteCandidates(text);
    if (locals.length > 0) {
      setGhostCandidates(locals);
      setGhost(locals[0]!);
      return;
    }

    const sequence = ++sequenceRef.current;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      completeCommand(text, { cwd }, controller.signal)
        .then((suffix) => {
          if (suffix && sequence === sequenceRef.current && !controller.signal.aborted) {
            setGhostCandidates([suffix]);
            setGhost(suffix);
          }
        })
        .catch(() => {});
    }, completeDebounceMs);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [aiMode, completeDebounceMs, completeOn, cwd, isFocused, text, visible]);

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
      setGhost('');
      setGhostCandidates([]);
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
    ghost,
    ghostCandidates,
    clearGhost,
    acceptCompletion,
    restoreCompletion,
  };
}
