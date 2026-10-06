import { ChevronDown, Search } from '@ui/icons';
import { useGlobalSearch } from '@features/search/hooks/useGlobalSearch';
import FilterPopover from '@features/search/components/FilterPopover';
import SearchResultCard from '@features/search/components/SearchResultCard';
import ErrorBox from '@ui/ErrorBox';

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
    failedSources,
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
      <div className="workspace-floating workspace-floating-dialog" role="dialog" aria-modal="true" aria-label="全局搜索"
        style={{
          width: 480,
          maxWidth: 'calc(100vw - 40px)',
          minHeight: 240,
          maxHeight: 'min(400px, 72vh)',
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
            padding: '8px 10px',
            margin: 10,
            borderRadius: 'var(--radius-inner)',
            background: 'var(--canvas)',
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
              fontSize: 'calc(13px * var(--ui-font-scale))',
              height: 28,
              padding: 0,
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-ui)',
            }}
          />
          <button
            data-testid="search-filter-button"
            onClick={() => setFilterOpen((openState) => !openState)}
            data-tip="筛选搜索范围"
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
              fontSize: 'calc(12px * var(--ui-font-scale))',
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
            borderBottomLeftRadius: 'var(--radius-block)',
            borderBottomRightRadius: 'var(--radius-block)',
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
                }}
              >
                <span style={{ fontSize: 'calc(11px * var(--ui-font-scale))', color: 'var(--text-muted)', fontWeight: 600 }}>
                  最近搜索
                </span>
                <button
                  onClick={() => searchHistory.clear()}
                  style={{
                    fontSize: 'calc(10px * var(--ui-font-scale))',
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
                  className="workspace-floating-row"
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
                    fontSize: 'calc(12px * var(--ui-font-scale))',
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
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 'calc(12px * var(--ui-font-scale))' }}>
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
                  fontSize: 'calc(10px * var(--ui-font-scale))',
                  fontWeight: 600,
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
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
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 'calc(12px * var(--ui-font-scale))' }}>
              搜索中…
            </div>
          )}
          {hasInput && !state.loading && failedSources.length > 0 && (
            <ErrorBox
              style={{ margin: '6px 2px' }}
              title={`部分搜索源失败：${failedSources.map((source) => source.label).join('、')}`}
              details={failedSources.map((source) => `${source.label}: ${source.error}`).join('\n')}
              detailsTitle="错误详情"
              actions={<button onClick={() => handleInput(input)} style={{ minHeight: 32 }}>重试</button>}
            >
              结果可能不完整，请检查对应来源后重试。
            </ErrorBox>
          )}

          {hasInput && !hasResults && !state.loading && failedSources.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 'calc(12px * var(--ui-font-scale))' }}>
              无匹配结果
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
