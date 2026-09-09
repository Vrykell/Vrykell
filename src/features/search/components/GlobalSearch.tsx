import { ChevronDown, type LucideIcon, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import FilterPopover from '@/features/search/components/FilterPopover';
import SearchResultCard from '@/features/search/components/SearchResultCard';
import { useSearchEngine } from '@/features/search/engine';
import { getSources, useEnabledSourcesStore } from '@/features/search/registry';
import type {
  ActionResultData,
  BlockResultData,
  FileResultData,
  HistoryResultData,
  ResultType,
  SearchResult,
  SessionResultData,
} from '@/features/search/types';
import * as sessionManager from '@/services/tauri/sessionManager';
import { getCommands } from '@/shared/constants/commands';
import { useSearchHighlightStore } from '@/store/searchHighlight';
import { useSearchHistoryStore } from '@/store/searchHistory';
import { useTerminalStore } from '@/store/terminal';
import { useWorkspaceStore } from '@/store/workspace';

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * GlobalSearch — 全局搜索（居中弹窗，类似新建标签页选择页）。
 * 顶栏搜索按钮或 ⌘F 打开；窗口顶部是搜索栏，下方为分组结果。
 */
export default function GlobalSearch({ open, onClose }: Props) {
  const setHighlightQuery = useSearchHighlightStore((s) => s.setQuery);
  const setPendingInput = useTerminalStore((s) => s.setPendingInput);
  const [input, setInput] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [filterOpen, setFilterOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { state, search } = useSearchEngine();
  const searchHistory = useSearchHistoryStore((s) => s);
  const addSearchHistory = useSearchHistoryStore((s) => s.add);
  const enabledIds = useEnabledSourcesStore((s) => s.enabledIds);

  // 切换筛选源后，用当前输入重新搜索，让结果列表立即更新
  useEffect(() => {
    if (open && input.trim()) search(input);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabledIds]);

  // 打开时重置状态并聚焦
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
    (v: string) => {
      setInput(v);
      setSelectedIdx(0);
      search(v);
      // 实时更新终端高亮
      setHighlightQuery(v.trim());
    },
    [search, setHighlightQuery],
  );

  // 分类结果
  const grouped = useMemo(() => {
    const groups: { type: ResultType; label: string; icon: LucideIcon; results: SearchResult[] }[] =
      [];
    const sources = getSources();
    for (const s of sources) {
      if (!enabledIds.has(s.id)) continue;
      const results = state.sources[s.id]?.results ?? [];
      if (results.length > 0) {
        groups.push({ type: s.id, label: s.label, icon: s.icon, results });
      }
    }
    return groups;
  }, [state.sources, enabledIds]);

  const sourceCounts = useMemo(() => {
    const counts: Partial<Record<ResultType, number>> = {};
    for (const g of grouped) counts[g.type] = g.results.length;
    return counts;
  }, [grouped]);

  const enabledCount = enabledIds.size;
  const totalSources = getSources().length;
  const flatResults = useMemo(() => grouped.flatMap((g) => g.results), [grouped]);

  // 点击结果卡片
  const handleExecute = useCallback(
    (result: SearchResult) => {
      addSearchHistory(input.trim());
      close();

      switch (result.type) {
        case 'history': {
          const d = result.data as HistoryResultData;
          setPendingInput(d.command);
          break;
        }
        case 'block': {
          const d = result.data as BlockResultData;
          // 历史会话的块：恢复会话
          if (d.sessionStatus === 'historical') {
            sessionManager.restore(d.tabId, d.tabTitle ?? '').catch((e) => {
              console.warn('handleExecute restore block session failed:', e);
            });
            return;
          }
          // 活跃会话：跳转 + 滚动
          useWorkspaceStore.getState().activate(d.tabId);
          setTimeout(() => {
            const el = document.querySelector(`[data-block-id="${d.blockId}"]`);
            el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }, 100);
          break;
        }
        case 'file': {
          const d = result.data as FileResultData;
          setPendingInput(d.path);
          break;
        }
        case 'setting': {
          useWorkspaceStore.getState().openSettingsTab();
          break;
        }
        case 'action': {
          const d = result.data as ActionResultData;
          const cmd = getCommands().find((c) => c.id === d.commandId);
          if (cmd) cmd.action();
          break;
        }
        case 'session': {
          const d = result.data as SessionResultData;
          if (d.status === 'historical') {
            // 历史会话 → 恢复
            sessionManager.restore(d.sessionId, d.title).catch((e) => {
              console.warn('handleExecute restore failed:', e);
            });
          } else {
            // 活跃会话 → 切换标签页
            useWorkspaceStore.getState().activate(d.sessionId);
          }
          break;
        }
      }
    },
    [input, addSearchHistory, close, setPendingInput],
  );

  const handleKey = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIdx((s) => Math.min(s + 1, flatResults.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIdx((s) => Math.max(s - 1, 0));
      } else if (e.key === 'Enter') {
        const selected = flatResults[selectedIdx];
        if (!selected) return;
        e.preventDefault();
        handleExecute(selected);
      }
    },
    [flatResults, selectedIdx, handleExecute, close],
  );

  // 恢复历史会话
  const handleRestore = useCallback((sessionId: string, sessionTitle: string) => {
    sessionManager.restore(sessionId, sessionTitle).catch((e) => {
      console.warn('handleRestore failed:', e);
    });
  }, []);

  const hasInput = input.trim().length > 0;
  const hasResults = flatResults.length > 0;
  const hasHistory = searchHistory.items.length > 0;

  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9996,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--overlay)',
      }}
      onClick={close}
    >
      <div
        style={{
          width: 480,
          maxWidth: 'calc(100vw - 40px)',
          minHeight: 240,
          maxHeight: 'min(400px, 72vh)',
          background: 'var(--elevated)',
          border: '1px solid var(--border-strong)',
          borderRadius: 12,
          boxShadow: 'var(--shadow-lg)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'visible',
        }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKey}
      >
        {/* 搜索栏（窗口最上面） */}
        <div
          style={{
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '12px 16px',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <Search size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => handleInput(e.target.value)}
            placeholder="搜索文件、命令、设置…"
            style={{
              flex: 1,
              minWidth: 0,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              fontSize: 15,
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-ui)',
            }}
          />
          <button
            data-testid="search-filter-button"
            onClick={() => setFilterOpen(!filterOpen)}
            title="筛选搜索范围"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 3,
              padding: '4px 10px',
              border: '1px solid var(--border)',
              borderRadius: 6,
              background: filterOpen ? 'var(--hover)' : 'transparent',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              fontSize: 12,
              fontFamily: 'var(--font-ui)',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            {enabledCount < totalSources ? `${enabledCount}/${totalSources}` : ''}
            <ChevronDown size={12} />
          </button>

          <FilterPopover
            open={filterOpen}
            onClose={() => setFilterOpen(false)}
            counts={sourceCounts}
          />
        </div>

        {/* 结果区 */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            overflowX: 'hidden',
            padding: '6px 10px 12px',
            minHeight: 220,
            borderBottomLeftRadius: 12,
            borderBottomRightRadius: 12,
          }}
        >
          {/* 搜索历史 */}
          {!hasInput && hasHistory && (
            <div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '6px 8px',
                  borderBottom: '1px solid var(--border)',
                }}
              >
                <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>
                  最近搜索
                </span>
                <button
                  onClick={() => searchHistory.clear()}
                  style={{
                    fontSize: 10,
                    padding: '2px 8px',
                    border: 'none',
                    borderRadius: 3,
                    background: 'transparent',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                  }}
                >
                  清除
                </button>
              </div>
              {searchHistory.items.slice(0, 8).map((item, i) => (
                <button
                  key={`sh-${i}`}
                  onClick={() => {
                    handleInput(item);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    width: '100%',
                    textAlign: 'left',
                    padding: '7px 10px',
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                    fontSize: 12,
                    fontFamily: 'var(--font-ui)',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--hover)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <Search size={11} style={{ flexShrink: 0 }} />
                  {item}
                </button>
              ))}
            </div>
          )}

          {/* 无输入且无历史 */}
          {!hasInput && !hasHistory && (
            <div
              style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}
            >
              输入关键词搜索文件、命令、设置…
            </div>
          )}

          {/* 分组搜索结果 */}
          {hasResults &&
            grouped.map((group) => (
              <div key={group.type}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: '6px 10px',
                    fontSize: 10,
                    fontWeight: 600,
                    color: 'var(--text-muted)',
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                    borderTop: '1px solid var(--border)',
                  }}
                >
                  <group.icon size={11} /> {group.label}
                </div>
                {group.results.map((result) => {
                  const idx = flatResults.indexOf(result);
                  return (
                    <SearchResultCard
                      key={result.id}
                      result={result}
                      selected={idx === selectedIdx}
                      query={input.trim()}
                      onSelect={() => setSelectedIdx(idx)}
                      onExecute={handleExecute}
                      onRestore={handleRestore}
                    />
                  );
                })}
              </div>
            ))}

          {hasInput && !hasResults && state.loading && (
            <div
              style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}
            >
              搜索中…
            </div>
          )}
          {hasInput && !hasResults && !state.loading && (
            <div
              style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}
            >
              无匹配结果
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
