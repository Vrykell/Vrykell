import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Search } from './icons';
import { TextInput } from './TextInput';
import { IconButton } from './IconButton';

interface HistoryPageProps {
  pageTestId: string;
  listLabel: string;
  icon: ReactNode;
  title: string;
  count: string;
  query: string;
  onQueryChange: (value: string) => void;
  searchLabel: string;
  searchPlaceholder: string;
  searchTestId: string;
  listClassName?: string;
  searchActions?: ReactNode;
  headerActions?: ReactNode;
  filterChips?: ReactNode;
  overlays?: ReactNode;
  children: ReactNode;
  busy?: boolean;
}

/** Shared workspace history shell, search field and list spacing. */
export default function HistoryPage({
  pageTestId,
  listLabel,
  icon,
  title,
  count,
  query,
  onQueryChange,
  searchLabel,
  searchPlaceholder,
  searchTestId,
  listClassName,
  searchActions,
  headerActions,
  filterChips,
  overlays,
  children,
  busy = false,
}: HistoryPageProps) {
  const [searchOpen, setSearchOpen] = useState(query.length > 0);
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (searchOpen) requestAnimationFrame(() => searchRef.current?.focus()); }, [searchOpen]);
  const closeSearch = () => { if (query) onQueryChange(''); setSearchOpen(false); };
  const collapseSearch = () => setSearchOpen(false);
  return <div className="history-page" data-testid={pageTestId} aria-busy={busy}>
    <div className="history-header">
      <div className="history-heading">
        {icon}
        <strong>{title}</strong>
        <span className="history-count">· {count}</span>
      </div>
      {filterChips && <div className="history-filter-cards" data-testid="history-filter-cards">{filterChips}</div>}
      <div className="history-toolbar">
        {searchOpen && <div className="history-search">
          <Search size={12} aria-hidden="true" />
          <TextInput ref={searchRef} className="history-search-input" aria-label={searchLabel} placeholder={searchPlaceholder}
            value={query} onChange={event => onQueryChange(event.target.value)} data-testid={searchTestId}
            onBlur={event => {
              if (!event.relatedTarget || !event.currentTarget.parentElement?.contains(event.relatedTarget)) collapseSearch();
            }}
            onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); closeSearch(); } }} />
        </div>}
        <div className="history-actions">
          {!searchOpen && <IconButton compact className="history-icon-button" aria-label={searchLabel}
            data-tip={searchLabel} data-testid="history-search-toggle" aria-expanded="false"
            onClick={() => setSearchOpen(true)}><Search size={16} /></IconButton>}
          {headerActions}
          {searchActions}
        </div>
      </div>
    </div>
    {overlays}
    <div className={`history-list scroll-region${listClassName ? ` ${listClassName}` : ''}`} aria-label={listLabel}>
      {children}
    </div>
  </div>;
}
