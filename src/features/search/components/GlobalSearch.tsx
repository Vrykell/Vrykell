import KeyHint from '@ui/KeyHint';
import { IconButton } from '@ui/IconButton';
import { TextButton } from '@ui/TextButton';
import { parseSearchQuery, SEARCH_PREFIXES } from '../model/searchQuery';
import { TextInput } from '@ui/TextInput';
import { ChevronDown, History, Search, SlidersHorizontal, X } from '@ui/icons';
import { t } from '@i18n';
import { useGlobalSearch } from '@features/search/hooks/useGlobalSearch';
import { getSources } from '@features/search/services/registry';
import FilterPopover from './FilterPopover';
import SearchResultCard from './SearchResultCard';
import ErrorBox from '@ui/ErrorBox';

interface Props {
  open: boolean;
  onClose: () => void;
}

/** Present workspace search as a compact palette with grouped results. */
export default function GlobalSearch({ open, onClose }: Props) {
  const {
    input, inputRef, query, selectedIdx, filterOpen, setFilterOpen, setSelectedIdx,
    state, searchHistory, grouped, sourceCounts, enabledCount, enabledIds, totalSources,
    flatResults, failedSources, hasInput, hasResults, hasHistory,
    handleInput, handleExecute, handleKey, handleRestore, close,
  } = useGlobalSearch({ open, onClose });

  if (!open) return null;
  const activeSource = getSources().find(source => source.id === query.source);

  return (
    <div className="global-search-overlay" onClick={close}>
      <div className="workspace-floating workspace-floating-dialog global-search-dialog"
        role="dialog" aria-modal="true" aria-label={t('Global search')}
        onClick={event => event.stopPropagation()} onKeyDown={handleKey}>
        <header className="global-search-header">
          <div className="global-search-input-row">
            <div className="global-search-query">
              <Search size={18} />
              {activeSource && <span className="search-scope-chip" data-testid="search-scope-chip">
                <activeSource.icon size={14} /><span>{activeSource.label}</span>
                <button data-subtle aria-label={t('Clear search scope')} data-tip={t('Clear search scope')}
                  onClick={() => { handleInput(query.term); inputRef.current?.focus(); }}><X size={12} /></button>
              </span>}
              <TextInput ref={inputRef} value={query.source ? query.term : input} onChange={event => handleInput(query.source ? `${query.prefix} ${event.target.value}` : event.target.value)}
                aria-label={t('Search workspace')} placeholder={t('Search files, commands, settings…')} />
            </div>
            {!query.source && <div className="global-search-filter-anchor">
              <TextButton data-testid="search-filter-button" className="global-search-filter"
                aria-expanded={filterOpen} aria-haspopup="menu" data-tip={t('Filter search scope')}
                onClick={() => setFilterOpen(value => !value)}>
                <SlidersHorizontal size={16} />
                <span>{t('Scope')}</span>
                {!query.source && enabledCount < totalSources && <span className="global-search-source-count">{enabledCount}/{totalSources}</span>}
                <ChevronDown size={12} />
              </TextButton>
              <FilterPopover open={filterOpen} onClose={() => setFilterOpen(false)} counts={sourceCounts} />
            </div>}
            <IconButton aria-label={t('Close search')} data-tip={t('Close search')} data-tip-shortcut="Escape" onClick={close}><X size={16} /></IconButton>
          </div>
        </header>

        <div className="global-search-body">
          {!hasInput && hasHistory && (
            <section>
              <div className="global-search-section-heading">
                <span>{t('Recent searches')}</span>
                <TextButton className="global-search-clear" onClick={() => searchHistory.clear()}>{t('Clear')}</TextButton>
              </div>
              {searchHistory.items.slice(0, 8).map((item, index) => {
                const parsed = parseSearchQuery(item);
                const source = getSources().find(source => source.id === parsed.source);
                return <button data-subtle key={`sh-${index}`} className="workspace-floating-row global-search-history"
                  onClick={() => handleInput(item)}>
                  <History size={16} />
                  {source && <span className="search-scope-chip" data-testid="history-scope-chip"><source.icon size={14} />{source.label}</span>}
                  <span>{parsed.term || (source ? '' : item)}</span>
                </button>;
              })}
            </section>
          )}

          {!hasInput && !hasHistory && (
            <div className="global-search-empty">
              <p className="global-search-empty-title">{t('Find something in your workspace')}</p>
              <p>{t('Commands, files and settings, all in one place.')}</p>
              <div className="global-search-sources" aria-label={t('Search scope')}>
                {getSources().map(source => (
                  <button data-subtle key={source.id} data-enabled={enabledIds.has(source.id)} className="global-search-source"
                    onClick={() => handleInput(`${SEARCH_PREFIXES.find(scope => scope.source === source.id)?.prefix ?? ''} `)}>
                    <source.icon size={16} /><span>{source.label}</span><kbd>{SEARCH_PREFIXES.find(scope => scope.source === source.id)?.prefix}</kbd>
                  </button>
                ))}
              </div>
            </div>
          )}

          {hasResults && grouped.map(group => (
            <section key={group.type} className="global-search-result-group">
              <div className="global-search-section-heading">
                <span><group.icon size={14} />{group.label}</span>
                <span className="global-search-source-count">{group.results.length}</span>
              </div>
              {group.results.map(result => {
                const index = flatResults.indexOf(result);
                return <SearchResultCard key={result.id} result={result} selected={index === selectedIdx}
                  query={query.term.trim()} onSelect={() => setSelectedIdx(index)}
                  onExecute={handleExecute} onRestore={handleRestore} />;
              })}
            </section>
          ))}

          {hasInput && !hasResults && state.loading && (
            <div className="global-search-message" role="status">{t('Searching…')}</div>
          )}
          {hasInput && !state.loading && failedSources.length > 0 && (
            <ErrorBox style={{ margin: '8px 4px' }}
              title={t('Some search sources failed: {{sources}}', { sources: failedSources.map(source => source.label).join(', ') })}
              details={failedSources.map(source => `${source.label}: ${source.error}`).join('\n')}
              detailsTitle={t('Error details')}
              actions={<button onClick={() => handleInput(input)}>{t('Retry')}</button>}>
              {t('Results may be incomplete. Retry the affected sources.')}
            </ErrorBox>
          )}
          {hasInput && !hasResults && !state.loading && failedSources.length === 0 && (
            <div className="global-search-message" role="status">
              <p className="global-search-empty-title">{t('No matching results')}</p>
              <p>{enabledCount === 0 ? t('Select at least one search source.') : t('Try another keyword or expand the search scope.')}</p>
            </div>
          )}
        </div>

        <footer className="global-search-footer">
          <div className="global-search-shortcuts">
            <span><KeyHint shortcut="ArrowUp" /><KeyHint shortcut="ArrowDown" />{t('Navigate')}</span>
            <span><KeyHint shortcut="Enter" />{t('Use result')}</span>
          </div>
          <span className="global-search-summary" aria-live="polite">
            {hasInput ? t('{{count}} results', { count: flatResults.length }) : t('{{count}} search sources', { count: enabledCount })}
          </span>
        </footer>
      </div>
    </div>
  );
}
