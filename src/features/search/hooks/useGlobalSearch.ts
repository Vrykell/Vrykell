import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { AppIcon } from '@ui/icons';
import { getCommands } from '@app/commands';
import { useSessionStore } from '@features/workspace';
import { useTerminalStore } from '@features/terminal';
import type {
  ActionResultData,
  BlockResultData,
  FileResultData,
  HistoryResultData,
  ResultType,
  SearchResult,
  SessionResultData,
  SettingResultData,
} from '@features/search/types';
import { getSources, useEnabledSourcesStore } from '@features/search/services/registry';
import { useSearchEngine } from '@features/search/hooks/useSearchEngine';
import { useSearchHistoryStore } from '@features/search/stores/searchHistory';
import { useSearchHighlightStore } from '@features/search/stores/searchHighlight';
import * as sessionManager from '@features/workspace/services/sessionManager';
import { getSettings } from '@features/settings/services/registry';
import { useToastStore } from '@ui/Toast';

/** Restore failures are user-visible: log them and surface a toast. */
function notifyRestoreFailure(context: string, error: unknown): void {
  console.warn(`${context}:`, error);
  useToastStore.getState().addToast(`${context}：${String((error as Error)?.message ?? error)}`, 'error');
}

export interface UseGlobalSearchOptions {
  open: boolean;
  onClose: () => void;
}

export interface SearchGroup {
  type: ResultType;
  label: string;
  icon: AppIcon;
  results: SearchResult[];
}

/** 聚合全局搜索的输入、异步请求、结果导航和跨领域动作。 */
export function useGlobalSearch({ open, onClose }: UseGlobalSearchOptions) {
  const setHighlightQuery = useSearchHighlightStore((state) => state.setQuery);
  const setPendingInput = useTerminalStore((state) => state.setPendingInput);
  const [input, setInput] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [filterOpen, setFilterOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { state, search } = useSearchEngine();
  const searchHistory = useSearchHistoryStore((state) => state);
  const addSearchHistory = useSearchHistoryStore((state) => state.add);
  const enabledIds = useEnabledSourcesStore((state) => state.enabledIds);

  useEffect(() => {
    if (open && input.trim()) search(input);
  }, [enabledIds, open, input, search]);

  useEffect(() => {
    if (!open) return;
    setInput('');
    setSelectedIdx(0);
    setFilterOpen(false);
    setHighlightQuery('');
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open, setHighlightQuery]);

  const close = useCallback(() => {
    setHighlightQuery('');
    onClose();
  }, [onClose, setHighlightQuery]);

  const handleInput = useCallback(
    (value: string) => {
      setInput(value);
      setSelectedIdx(0);
      search(value);
      setHighlightQuery(value.trim());
    },
    [search, setHighlightQuery],
  );

  const grouped = useMemo<SearchGroup[]>(() => {
    const groups: SearchGroup[] = [];
    for (const source of getSources()) {
      if (!enabledIds.has(source.id)) continue;
      const results = state.sources[source.id]?.results ?? [];
      if (results.length > 0) {
        groups.push({ type: source.id, label: source.label, icon: source.icon, results });
      }
    }
    return groups;
  }, [enabledIds, state.sources]);

  const sourceCounts = useMemo(() => {
    const counts: Partial<Record<ResultType, number>> = {};
    for (const group of grouped) counts[group.type] = group.results.length;
    return counts;
  }, [grouped]);

  const enabledCount = enabledIds.size;
  const totalSources = getSources().length;
  const flatResults = useMemo(() => grouped.flatMap((group) => group.results), [grouped]);
  /** Enabled sources that failed this round (errors are collected by the engine). */
  const failedSources = useMemo(
    () => getSources()
      .filter((source) => enabledIds.has(source.id) && state.sources[source.id]?.error)
      .map((source) => ({ id: source.id, label: source.label, error: state.sources[source.id]!.error! })),
    [enabledIds, state.sources],
  );

  const handleExecute = useCallback(
    (result: SearchResult) => {
      addSearchHistory(input.trim());
      close();

      switch (result.type) {
        case 'history': {
          const data = result.data as HistoryResultData;
          setPendingInput(data.command);
          break;
        }
        case 'block': {
          const data = result.data as BlockResultData;
          if (data.sessionStatus === 'historical') {
            sessionManager.restore(data.tabId, data.tabTitle ?? '').catch((error) => {
              notifyRestoreFailure('恢复历史区块所属会话失败', error);
            });
            return;
          }
          useSessionStore.getState().activate(data.tabId);
          setTimeout(() => {
            const element = document.querySelector(`[data-block-id="${data.blockId}"]`);
            element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }, 100);
          break;
        }
        case 'file': {
          const data = result.data as FileResultData;
          setPendingInput(data.path);
          break;
        }
        case 'setting': {
          const data = result.data as SettingResultData;
          const setting = getSettings().find(item => item.id === data.settingId);
          if (setting) setting.onSelect();
          else useSessionStore.getState().openSettingsTab();
          break;
        }
        case 'action': {
          const data = result.data as ActionResultData;
          const command = getCommands().find((item) => item.id === data.commandId);
          command?.action();
          break;
        }
        case 'session': {
          const data = result.data as SessionResultData;
          if (data.status === 'historical') {
            sessionManager.restore(data.sessionId, data.title).catch((error) => {
              notifyRestoreFailure('恢复历史会话失败', error);
            });
          } else {
            useSessionStore.getState().activate(data.sessionId);
          }
          break;
        }
      }
    },
    [addSearchHistory, close, input, setPendingInput],
  );

  const handleKey = useCallback(
    (event: ReactKeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSelectedIdx((current) => Math.min(current + 1, flatResults.length - 1));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSelectedIdx((current) => Math.max(current - 1, 0));
      } else if (event.key === 'Enter') {
        const selected = flatResults[selectedIdx];
        if (!selected) return;
        event.preventDefault();
        handleExecute(selected);
      }
    },
    [close, flatResults, handleExecute, selectedIdx],
  );

  const handleRestore = useCallback((sessionId: string, sessionTitle: string) => {
    sessionManager.restore(sessionId, sessionTitle).catch((error) => {
      notifyRestoreFailure('恢复历史会话失败', error);
    });
  }, []);

  const hasInput = input.trim().length > 0;
  const hasResults = flatResults.length > 0;
  const hasHistory = searchHistory.items.length > 0;

  return {
    input,
    inputRef,
    selectedIdx,
    filterOpen,
    setFilterOpen,
    setSelectedIdx,
    state,
    searchHistory,
    grouped,
    sourceCounts,
    enabledCount,
    totalSources,
    flatResults,
    failedSources,
    hasInput,
    hasResults,
    hasHistory,
    handleInput,
    handleExecute,
    handleKey,
    handleRestore,
    close,
  };
}
