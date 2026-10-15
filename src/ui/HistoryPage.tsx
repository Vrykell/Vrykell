import type { ReactNode } from 'react';
import { Search } from './icons';
import { TextInput } from './TextInput';

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
  overlays,
  children,
  busy = false,
}: HistoryPageProps) {
  return <div className="history-page" data-testid={pageTestId} aria-busy={busy}>
    <div className="history-header">
      <div className="history-heading">
        {icon}
        <strong>{title}</strong>
        <span className="history-count">· {count}</span>
      </div>
      <div className="history-search">
        <Search size={12} aria-hidden="true" />
        <TextInput className="history-search-input" aria-label={searchLabel} placeholder={searchPlaceholder}
          value={query} onChange={event => onQueryChange(event.target.value)} data-testid={searchTestId} />
        {searchActions}
      </div>
      {headerActions && <div className="history-actions">{headerActions}</div>}
    </div>
    {overlays}
    <div className={`history-list scroll-region${listClassName ? ` ${listClassName}` : ''}`} aria-label={listLabel}>
      {children}
    </div>
  </div>;
}
