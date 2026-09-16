import { ChevronDown, Search } from 'lucide-react';
import { useGlobalSearch } from '@features/search/hooks/useGlobalSearch';
import FilterPopover from '@features/search/components/FilterPopover';
import SearchResultCard from '@features/search/components/SearchResultCard';

interface Props {
  open: boolean;
  onClose: () => void;
}

/** 全局搜索视图：负责布局和展示，搜索编排由 useGlobalSearch 提供。 */
export default function GlobalSearch({ open, onClose }: Props) {
  const {
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
    hasInput,
    hasResults,
    hasHistory,
    handleInput,
    handleExecute,
    handleKey,
    handleRestore,
    close,
  } = useGlobalSearch({ open, onClose });

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
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleKey}
      >
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
            onChange={(event) => handleInput(event.target.value)}
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
            onClick={() => setFilterOpen((openState) => !openState)}
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
              {searchHistory.items.slice(0, 8).map((item, index) => (
                <button
                  key={`sh-${index}`}
                  onClick={() => handleInput(item)}
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
                  onMouseEnter={(event) => {
                    event.currentTarget.style.background = 'var(--hover)';
                  }}
                  onMouseLeave={(event) => {
                    event.currentTarget.style.background = 'transparent';
                  }}
                >
                  <Search size={11} style={{ flexShrink: 0 }} />
                  {item}
                </button>
              ))}
            </div>
          )}

          {!hasInput && !hasHistory && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
              输入关键词搜索文件、命令、设置
            </div>
          )}

          {hasResults && grouped.map((group) => (
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
                const index = flatResults.indexOf(result);
                return (
                  <SearchResultCard
                    key={result.id}
                    result={result}
                    selected={index === selectedIdx}
                    query={input.trim()}
                    onSelect={() => setSelectedIdx(index)}
                    onExecute={handleExecute}
                    onRestore={handleRestore}
                  />
                );
              })}
            </div>
          ))}

          {hasInput && !hasResults && state.loading && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
              搜索中…
            </div>
          )}
          {hasInput && !hasResults && !state.loading && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
              无匹配结果
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
