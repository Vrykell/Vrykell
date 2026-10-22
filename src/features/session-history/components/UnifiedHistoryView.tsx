import { useState } from 'react';
import { t } from '@i18n';
import { History, HistorySmall, ServerSmall, SparklesSmall, Filter, StarSmall, Ellipsis, iconSizes } from '@ui/icons';
import { IconButton } from '@ui/IconButton';
import ReloadButton from '@ui/ReloadButton';
import { OutlineButton } from '@ui/OutlineButton';
import HistoryPage from '@ui/HistoryPage';
import HistoryGroupCard from '@ui/HistoryGroupCard';
import HistoryOptionMenu from '@ui/HistoryOptionMenu';
import ContextMenu, { type MenuAnchor } from '@ui/ContextMenu';
import ErrorBox from '@ui/ErrorBox';
import SidebarItem from '@ui/sidebarItem';
import { useSessionStore } from '@features/workspace';
import { iconColorCss, iconColorKey, useIconColorStore } from '@config/iconColors';
import { useUnifiedHistory } from '../hooks/useUnifiedHistory';
import { SESSION_DATE_OPTIONS } from '../model/sessionHistoryModel';
import { HISTORY_TYPES, type UnifiedHistoryRecord } from '../model/unifiedHistory';

const TYPE_LABELS = { all: 'All', terminal: 'Terminal history', local: 'Local terminals', ssh: 'SSH terminals', conversation: 'AI conversations' } as const;
const anchorFrom = (trigger: HTMLButtonElement): MenuAnchor => { const rect = trigger.getBoundingClientRect(); return { x: rect.left, y: rect.bottom + 4, trigger }; };

/** One chronological surface links saved records back to their owning workspaces. */
export default function UnifiedHistoryView() {
  const history = useUnifiedHistory();
  const [filterMenu, setFilterMenu] = useState<MenuAnchor | null>(null);
  const [actionsMenu, setActionsMenu] = useState<MenuAnchor | null>(null);
  const filtered = history.filter.type !== 'all' || history.filter.date !== 'all' || history.filter.starredOnly;
  const groups = new Map<string, UnifiedHistoryRecord[]>();
  for (const record of history.visible) {
    const day = new Date(record.timestamp).toLocaleDateString();
    const items = groups.get(day) ?? []; items.push(record); groups.set(day, items);
  }
  return <HistoryPage pageTestId="unified-history-page" listLabel={t('All history')} icon={<History size={iconSizes.control} />}
    title={t('All history')} count={t('{{count}} records', { count: history.visible.length })} busy={history.loading}
    query={history.filter.query} onQueryChange={query => history.setFilter({ query })}
    searchLabel={t('Search all history')} searchPlaceholder={t('Search terminals and AI conversations…')} searchTestId="unified-history-search"
    headerActions={<>
      <IconButton compact className="history-icon-button" aria-label={t('Filter history')} data-tip={t('Filter history')}
        data-active={filtered || undefined} aria-haspopup="menu" aria-expanded={!!filterMenu} data-testid="unified-history-filter"
        onClick={event => { setActionsMenu(null); setFilterMenu(filterMenu ? null : anchorFrom(event.currentTarget)); }}><Filter size={iconSizes.control} /></IconButton>
      <ReloadButton compact label={t('Refresh history')} busy={history.loading} onReload={history.refresh} />
      <IconButton compact className="history-icon-button" aria-label={t('More actions')} data-tip={t('More actions')} aria-haspopup="menu" aria-expanded={!!actionsMenu}
        onClick={event => { setFilterMenu(null); setActionsMenu(actionsMenu ? null : anchorFrom(event.currentTarget)); }}><Ellipsis size={iconSizes.control} /></IconButton>
    </>}
    overlays={<>
      {filterMenu && <HistoryOptionMenu anchor={filterMenu} testId="unified-history-filter-menu" onClose={() => setFilterMenu(null)} sections={[
        { label: t('Type'), options: HISTORY_TYPES.map(type => ({ label: t(TYPE_LABELS[type]), active: history.filter.type === type, onSelect: () => history.setFilter({ type }) })) },
        { label: t('Latest activity'), options: SESSION_DATE_OPTIONS.map(option => ({ label: t(option.label), active: history.filter.date === option.value, onSelect: () => history.setFilter({ date: option.value }) })) },
        { label: t('Favorites'), options: [{ label: t('Starred only'), active: history.filter.starredOnly, onSelect: () => history.setFilter({ starredOnly: !history.filter.starredOnly }) }] },
      ]} />}
      {actionsMenu && <ContextMenu anchor={actionsMenu} onClose={() => setActionsMenu(null)} items={[
        { label: t('Terminal history'), onClick: () => useSessionStore.getState().openHistoryTab() },
        { label: t('AI conversation history'), onClick: () => useSessionStore.getState().openAiHistoryTab() },
        { label: t('Clear filters'), group: 'view', onClick: history.resetFilter },
      ]} />}
    </>}>
    {history.terminalError && <ErrorBox title={t('Terminal history')} actions={<OutlineButton onClick={() => void history.refresh()}>{t('Retry')}</OutlineButton>}>{history.terminalError}</ErrorBox>}
    {history.conversationError && <ErrorBox title={t('AI conversation history')} actions={<OutlineButton onClick={() => void history.refresh()}>{t('Retry')}</OutlineButton>}>{history.conversationError}</ErrorBox>}
    {!history.visible.length && !history.loading && !history.terminalError && !history.conversationError && <div className="history-empty"><History size={24} /><span>{t(history.filter.query || filtered ? 'No matching history' : 'No history yet')}</span></div>}
    {history.loading && <div className="history-empty">{t('Loading history…')}</div>}
    {[...groups].map(([day, records]) => <HistoryGroupCard key={day} id={`unified-${day}`} title={day} count={t('{{count}} records', { count: records.length })} timestamp={records[0].timestamp}>
      {records.map(record => <UnifiedHistoryRow key={record.key} record={record} onOpen={() => history.open(record)} />)}
    </HistoryGroupCard>)}
  </HistoryPage>;
}

function UnifiedHistoryRow({ record, onOpen }: { record: UnifiedHistoryRecord; onOpen: () => void }) {
  const color = useIconColorStore(state => record.kind === 'terminal' ? iconColorCss(state.colors[iconColorKey('session', record.session.id)]) : undefined);
  const label = t(record.kind === 'conversation' ? 'AI conversation' : record.local && record.ssh ? 'Mixed connections' : record.ssh ? 'SSH terminal' : 'Local terminal');
  const Icon = record.kind === 'conversation' ? SparklesSmall : record.ssh ? ServerSmall : HistorySmall;
  return <SidebarItem variant="history" compact active={false} title={record.title || t(record.kind === 'conversation' ? 'New conversation' : 'Untitled session')}
    icon={<span className="history-row-icon" style={{ color }}><Icon size={iconSizes.row} /></span>}
    subtitle={[label, record.description, new Date(record.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }), record.note].filter(Boolean).join(' · ')} subtitleFontFamily="var(--font-ui)"
    badge={record.starred ? <StarSmall size={iconSizes.control} className="history-row-star" /> : undefined}
    testId={`unified-history-${record.key}`} dataAttributes={{ role: 'button', 'data-history-kind': record.kind }} tabIndex={0}
    onClick={onOpen} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen(); } }} />;
}
