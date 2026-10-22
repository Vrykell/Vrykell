import { t } from '@i18n';
import { ask } from '@tauri-apps/plugin-dialog';
import { sessionCommandCount, sessionHistoryDateField, sessionHistoryDirectories, sessionHistoryTimestamp, sessionSummaryText } from '../model/sessionHistoryModel';
import { useCallback, useMemo, useState } from 'react';
import { Monitor, MonitorSmall, History, HistorySmall, ServerSmall, Ellipsis, Filter, ArrowSort, Grid, LockSmall as Lock, StarSmall as Star, Undo2, X } from '@ui/icons';
import ContextMenu, { type ContextMenuItem, type MenuAnchor } from '@ui/ContextMenu';
import { IconButton } from '@ui/IconButton';
import HistoryOptionMenu, { type HistoryMenuSection } from '@ui/HistoryOptionMenu';
import HistoryGroupCard from '@ui/HistoryGroupCard';
import HistoryPage from '@ui/HistoryPage';
import HistoryTextPrompt from '@ui/HistoryTextPrompt';
import FilterChip from '@ui/FilterChip';
import SidebarItem from '@ui/sidebarItem';
import { iconColorCss, iconColorKey, useIconColorStore } from '@config/iconColors';
import type { BackendSessionEntry } from '@platform/api/types';
import {
  isSshSession,
  SESSION_DATE_OPTIONS,
  SESSION_TYPE_OPTIONS,
  SESSION_MODE_OPTIONS,
  SESSION_SORT_OPTIONS,
  SESSION_GROUP_BY_OPTIONS,
  groupHistoricalSessions,
  useSessionHistory,
} from '@features/session-history';
import { useToastStore } from '@ui/Toast';
import ErrorBox from '@ui/ErrorBox';
import { writeClipboardText } from '@platform/clipboard';
import { historyGroupKey, historyRecordKey, useHistoryMetaStore } from '@utils/historyMeta';
import { useHistoryGroupActions } from '@ui/hooks/useHistoryGroupActions';

/** Displays historical sessions grouped with restore, annotation and deletion actions. */
export default function SessionHistoryView() {
  const [filterMenu, setFilterMenu] = useState<{ x: number; y: number } | null>(null);
  const [sortMenu, setSortMenu] = useState<{ x: number; y: number } | null>(null);
  const [groupMenu, setGroupMenu] = useState<{ x: number; y: number } | null>(null);
  const [actionsMenu, setActionsMenu] = useState<{ x: number; y: number } | null>(null);
  const [rowMenu, setRowMenu] = useState<{ id: string; anchor: MenuAnchor } | null>(null);
  const [notePrompt, setNotePrompt] = useState<{ id: string; anchor: { x: number; y: number } } | null>(null);
  const notify = useCallback((message: string, kind: 'success' | 'error') => {
    useToastStore.getState().addToast(message, kind);
  }, []);
  const {
    loading,
    loadError,
    filter,
    setFilter,
    starredIds,
    load,
    openSession,
    deleteHistoricalSession,
    restoreSessions,
    deleteSessions,
    batchBusy,
    sessions,
    originalGroups,
    renameOriginalGroup,
    historical,
    hasFilter,
  } = useSessionHistory({ notify });
  const { query, type: typeFilter, date: dateFilter, mode = 'all', sort = 'closed-desc', groupBy = 'day', starredOnly = false } = filter;
  const dateField = filter.dateField ?? sessionHistoryDateField(sort);
  const groupOperations = useHistoryGroupActions('session', groupBy);
  const originalOperations = useHistoryGroupActions('session', 'original');
  const { meta, pinnedIds } = groupOperations;
  const { notes, lockedRecords } = meta;
  const historyGroups = useMemo(
    () => groupHistoricalSessions(historical, groupBy, sort, dateField, new Set([...pinnedIds, ...originalOperations.pinnedIds]),
      { groups: originalGroups, sessions }),
    [historical, groupBy, sort, dateField, pinnedIds, originalOperations.pinnedIds, originalGroups, sessions],
  );

  const noteKey = (id: string) => historyRecordKey('session', id);
  const closeSharedMenus = () => { setFilterMenu(null); setSortMenu(null); setGroupMenu(null); setActionsMenu(null); };
  const openRowMenu = (session: BackendSessionEntry, anchor: MenuAnchor) => {
    closeSharedMenus();
    setNotePrompt(null);
    setRowMenu(current => current?.id === session.id ? null : { id: session.id, anchor });
  };
  const copySummaries = (items: readonly BackendSessionEntry[]) => {
    void writeClipboardText(items.map(session => sessionSummaryText(session)).join('\n\n---\n\n'))
      .then(() => notify(t('Copied'), 'success'))
      .catch(() => notify(t('Copy failed'), 'error'));
  };
  const deletable = (items: readonly BackendSessionEntry[]) => items.filter(item => item.status === 'historical'
    && !useHistoryMetaStore.getState().lockedRecords[noteKey(item.id)]);
  const deleteMatching = async (items: readonly BackendSessionEntry[]) => {
    const targets = deletable(items);
    if (batchBusy || !targets.length) return;
    if (await ask(t('Delete {{count}} matching sessions and their history? Locked records are excluded.', { count: targets.length }),
      { title: t('Delete sessions'), kind: 'warning' })) await deleteSessions(targets);
  };
  const groupItems = (items: readonly BackendSessionEntry[], restoreLabel: string): ContextMenuItem[] => [
    { label: restoreLabel, disabled: batchBusy, onClick: () => { void restoreSessions(items); } },
    { label: t('Copy matching session summaries'), group: 'clipboard', onClick: () => copySummaries(items) },
    { label: t('Delete {{count}} matching sessions…', { count: deletable(items).length }), danger: true,
      disabled: batchBusy || !deletable(items).length, onClick: () => { void deleteMatching(items); } },
  ];
  const rowMenuSession = rowMenu ? historical.find(item => item.id === rowMenu.id) ?? null : null;
  const notePromptSession = notePrompt ? historical.find(item => item.id === notePrompt.id) ?? null : null;
  const rowMenuItems: ContextMenuItem[] = [];
  if (rowMenu && rowMenuSession) {
    rowMenuItems.push(
      { label: rowMenuSession.status === 'historical' ? t('Restore session') : t('Open session'), onClick: () => openSession(rowMenuSession) },
      { label: t('Copy summary'), group: 'clipboard', onClick: () => copySummaries([rowMenuSession]) },
      { label: notes[noteKey(rowMenuSession.id)] ? t('Edit note…') : t('Add note…'), group: 'edit',
        onClick: () => { setRowMenu(null); setNotePrompt({ id: rowMenuSession.id, anchor: rowMenu.anchor }); } },
      { label: starredIds.has(rowMenuSession.id) ? t('Unstar') : t('Star'), group: 'view',
        onClick: () => useHistoryMetaStore.getState().toggleStar(noteKey(rowMenuSession.id)) },
      { label: t(lockedRecords[noteKey(rowMenuSession.id)] ? 'Unlock record' : 'Lock record'), group: 'organize',
        onClick: () => meta.setLocked([noteKey(rowMenuSession.id)], !lockedRecords[noteKey(rowMenuSession.id)]) },
    );
    if (rowMenuSession.status === 'historical') {
      rowMenuItems.push({ label: t('Delete this session'), danger: true, disabled: batchBusy || Boolean(lockedRecords[noteKey(rowMenuSession.id)]), onClick: () => deleteHistoricalSession(rowMenuSession) });
    }
  }

  const filterSections: HistoryMenuSection[] = [
    {
      label: t('Type'),
      options: SESSION_TYPE_OPTIONS.map(option => ({
        label: t(option.label), active: option.value === typeFilter,
        onSelect: () => setFilter({ type: option.value }),
      })),
    },
    {
      label: t('Terminal startup mode'),
      options: SESSION_MODE_OPTIONS.map(option => ({
        label: t(option.label), active: option.value === mode,
        onSelect: () => setFilter({ mode: option.value }),
      })),
    },
    {
      label: t('Date field'),
      options: (['closed', 'created'] as const).map(value => ({
        label: t(value === 'created' ? 'Created date' : 'Closed date'), active: value === dateField,
        onSelect: () => setFilter({ dateField: value }),
      })),
    },
    {
      label: t(dateField === 'created' ? 'Created date' : 'Closed date'),
      options: SESSION_DATE_OPTIONS.map(option => ({
        label: t(option.label), active: option.value === dateFilter,
        onSelect: () => setFilter({ date: option.value }),
      })),
    },
    {
      label: t('Favorites'),
      options: [{
        label: t('Starred only'), active: starredOnly === true,
        onSelect: () => setFilter({ starredOnly: starredOnly !== true }),
      }],
    },
  ];
  const sortSections: HistoryMenuSection[] = [{
    label: t(groupBy === 'none' ? 'Sort records' : 'Sort within groups'),
    options: SESSION_SORT_OPTIONS.map(option => ({
      label: t(option.label), active: option.value === sort,
      onSelect: () => { setFilter({ sort: option.value }); setSortMenu(null); },
    })),
  }];
  const groupSections: HistoryMenuSection[] = [{
    label: t('Group by'),
    options: SESSION_GROUP_BY_OPTIONS.map(option => ({
      label: t(option.label), active: option.value === groupBy,
      onSelect: () => { setFilter({ groupBy: option.value }); setGroupMenu(null); },
    })),
  }];

  const anchorFrom = (element: HTMLButtonElement, align: 'start' | 'end' = 'start') => {
    const rect = element.getBoundingClientRect();
    return { x: align === 'end' ? rect.right : rect.left, y: rect.bottom + 4, trigger: element };
  };
  const actionMenuAnchorFrom = (element: HTMLButtonElement) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.right - 180, y: rect.bottom + 4, trigger: element };
  };
  const hasFilterCard = typeFilter !== 'all' || mode !== 'all' || dateFilter !== 'all' || starredOnly;

  return (<HistoryPage
    busy={batchBusy}
    pageTestId="session-history-page"
    listLabel={t('Session history')}
    icon={<History size={13} aria-hidden="true" />}
    title={t('Session history')}
    count={`${t('{{count}} sessions', { count: historical.length })}${batchBusy ? ` · ${t('Working')}` : ''}`}
    query={query}
    onQueryChange={value => setFilter({ query: value })}
    searchLabel={t('Search sessions')}
    searchPlaceholder={t('Search sessions…')}
    searchTestId="session-filter-input"
    filterChips={hasFilterCard ? <>
      {typeFilter !== 'all' && <FilterChip testId="session-filter-card-type" removeLabel={t('Remove filter: {{filter}}', {
        filter: t(SESSION_TYPE_OPTIONS.find(option => option.value === typeFilter)?.label ?? typeFilter),
      })} onRemove={() => setFilter({ type: 'all' })}>
        {t(SESSION_TYPE_OPTIONS.find(option => option.value === typeFilter)?.label ?? typeFilter)}
      </FilterChip>}
      {mode !== 'all' && <FilterChip testId="session-filter-card-mode" removeLabel={t('Remove filter: {{filter}}', {
        filter: t(SESSION_MODE_OPTIONS.find(option => option.value === mode)?.label ?? mode),
      })} onRemove={() => setFilter({ mode: 'all' })}>
        {t(SESSION_MODE_OPTIONS.find(option => option.value === mode)?.label ?? mode)}
      </FilterChip>}
      {dateFilter !== 'all' && <FilterChip testId="session-filter-card-date" removeLabel={t('Remove filter: {{filter}}', {
        filter: t(SESSION_DATE_OPTIONS.find(option => option.value === dateFilter)?.label ?? dateFilter),
      })} onRemove={() => setFilter({ date: 'all' })}>
        {t(SESSION_DATE_OPTIONS.find(option => option.value === dateFilter)?.label ?? dateFilter)}
      </FilterChip>}
      {starredOnly && <FilterChip testId="session-filter-card-starred" removeLabel={t('Remove filter: {{filter}}', {
        filter: t('Starred only'),
      })} onRemove={() => setFilter({ starredOnly: false })}>{t('Starred only')}</FilterChip>}
    </> : undefined}
    headerActions={<>
      <IconButton compact className="toolbar-icon-button history-icon-button" aria-label={t('Filter sessions')}
        aria-haspopup="menu" aria-expanded={filterMenu !== null}
        data-tip={hasFilter ? t('Filters are active') : t('Filter sessions')}
        data-active={hasFilter ? 'true' : undefined} data-testid="session-filter-btn"
        onClick={event => { closeSharedMenus(); setRowMenu(null); setNotePrompt(null); if (!filterMenu) setFilterMenu(anchorFrom(event.currentTarget)); }}>
        <Filter size={16} aria-hidden="true" />
      </IconButton>
      <IconButton compact className="toolbar-icon-button history-icon-button" aria-label={t('Sort sessions')}
        aria-haspopup="menu" aria-expanded={sortMenu !== null}
        data-tip={t('Sort sessions')}
        data-active={sort !== 'closed-desc' ? 'true' : undefined} data-testid="session-sort-btn"
        onClick={event => { closeSharedMenus(); setRowMenu(null); setNotePrompt(null); if (!sortMenu) setSortMenu(anchorFrom(event.currentTarget, 'end')); }}>
        <ArrowSort size={16} aria-hidden="true" />
      </IconButton>
      <IconButton compact className="toolbar-icon-button history-icon-button" aria-label={t('Group by')}
        aria-haspopup="menu" aria-expanded={groupMenu !== null}
        data-tip={t('Group by')}
        data-tip-description={t('Time groups use the selected date field. Other groups are ordered by name; sorting applies within each group.')}
        data-active={groupBy !== 'day' ? 'true' : undefined} data-testid="session-history-group-by"
        onClick={event => { closeSharedMenus(); setRowMenu(null); setNotePrompt(null); if (!groupMenu) setGroupMenu(anchorFrom(event.currentTarget, 'end')); }}>
        <Grid size={16} aria-hidden="true" />
      </IconButton>
    </>}
    searchActions={<IconButton compact className="toolbar-icon-button history-icon-button" aria-label={t('More actions')}
      aria-haspopup="menu" aria-expanded={actionsMenu !== null} data-tip={t('More actions')}
      data-testid="session-history-actions-menu-button"
      onClick={event => { closeSharedMenus(); setRowMenu(null); setNotePrompt(null); if (!actionsMenu) setActionsMenu(actionMenuAnchorFrom(event.currentTarget)); }}>
      <Ellipsis size={16} aria-hidden="true" />
    </IconButton>}
    overlays={<>
      {actionsMenu && <ContextMenu anchor={actionsMenu} itemRole="menuitem"
        items={[
          { label: t('Refresh'), disabled: batchBusy, onClick: () => { void load(); } },
          { label: t('Restore {{count}} matching sessions', { count: historical.length }), disabled: batchBusy || !historical.length, onClick: () => { void restoreSessions(historical); } },
          { label: t('Copy matching session summaries'), group: 'clipboard', disabled: !historical.length, onClick: () => copySummaries(historical) },
          ...groupOperations.pageItems(historyGroups.filter(group => !group.originalGroup).map(group => group.id),
            historyGroups.filter(group => group.originalGroup).map(group => historyGroupKey('session', 'original', group.id))),
        ]}
        onClose={() => setActionsMenu(null)} />}
      {rowMenu && rowMenuSession && <ContextMenu anchor={rowMenu.anchor} items={rowMenuItems} itemRole="menuitem"
        onClose={() => setRowMenu(null)} />}
      {notePrompt && notePromptSession && <HistoryTextPrompt anchor={notePrompt.anchor} label={t('Note')}
        placeholder={t('Write a note…')} value={notes[noteKey(notePromptSession.id)] ?? ''} multiline saveLabel={t('Save')}
        testId={`session-note-${notePromptSession.id}`}
        onSave={text => useHistoryMetaStore.getState().setNote(noteKey(notePromptSession.id), text)}
        onClose={() => setNotePrompt(null)} />}
      {filterMenu && <HistoryOptionMenu anchor={filterMenu} testId="session-filter-menu" sections={filterSections}
        onClose={() => setFilterMenu(null)} width={184} maxHeight={360} />}
      {sortMenu && <HistoryOptionMenu anchor={sortMenu} testId="session-sort-menu" sections={sortSections}
        onClose={() => setSortMenu(null)} width={184} maxHeight={300} align="end" />}
      {groupMenu && <HistoryOptionMenu anchor={groupMenu} testId="session-group-menu" sections={groupSections}
        onClose={() => setGroupMenu(null)} width={184} maxHeight={360} align="end" />}
    </>}
  >
        {loading ? (
          <div className="history-empty">{t('Loading sessions…')}</div>
        ) : loadError ? (
          <ErrorBox
            style={{ margin: 8 }}
            actions={<button onClick={() => void load()} style={{ minHeight: 32 }}>{t('Retry')}</button>}
          >
            {loadError}
          </ErrorBox>
        ) : historical.length === 0 ? (
          <div className="history-empty">
            <Monitor size={22} aria-hidden="true" />
            <span>{query || hasFilter ? t('No matching sessions') : t('No sessions yet')}</span>
          </div>
        ) : (
          historyGroups.map(group => <HistoryGroupCard key={group.id} id={group.id}
            {...(group.originalGroup ? originalOperations : groupOperations).forGroup(group.id, group.title, group.sessions.map(session => session.id))}
            {...(group.originalGroup ? { title: group.title, originalTitle: undefined,
              onRename: (value: string) => { void renameOriginalGroup(group.originalGroup!.id, value); } } : {})}
            subtitle={group.originalGroup ? [t('Original tab group'), group.categoryTitle].filter(Boolean).join(' · ') : undefined}
            menuDescription={group.originalGroup
              ? t('Matching actions affect visible records. Restoring the original group also includes hidden members. Locked records cannot be deleted.') : undefined}
            timestamp={group.timestamp ?? group.sessions.reduce((latest, session) => Math.max(latest, sessionHistoryTimestamp(session, sort, dateField)), 0)}
            count={group.totalCount && group.totalCount !== group.sessions.length
              ? t('{{matching}} of {{total}} sessions', { matching: group.sessions.length, total: group.totalCount })
              : t('{{count}} sessions', { count: group.sessions.length })}
            actions={[
              ...(group.originalGroup && group.totalCount !== group.sessions.length ? [{
                label: t('Restore original group ({{count}} sessions)', { count: group.totalCount ?? 0 }), disabled: batchBusy,
                onClick: () => { void restoreSessions(sessions.filter(session => session.status === 'historical' && session.group_id === group.originalGroup!.id)); },
              }] : []),
              ...groupItems(group.sessions, t(group.originalGroup
                ? group.totalCount === group.sessions.length ? 'Restore group' : 'Restore matching' : 'Restore all')),
            ]}>
            {group.sessions.map(session => <SessionRow key={session.id} s={session}
              starred={starredIds.has(session.id)}
              note={notes[noteKey(session.id)]}
              locked={Boolean(lockedRecords[noteKey(session.id)])}
              onOpen={() => openSession(session)}
              onDelete={() => deleteHistoricalSession(session)}
              busy={batchBusy}
              onMenu={anchor => openRowMenu(session, anchor)} />)}
          </HistoryGroupCard>)
        )}
  </HistoryPage>);
}

function SessionRow({ s, starred, note, locked, onOpen, onDelete, busy, onMenu }: {
  s: BackendSessionEntry;
  starred: boolean;
  note?: string;
  locked: boolean;
  onOpen: () => void;
  onDelete: () => void;
  busy: boolean;
  onMenu: (anchor: MenuAnchor) => void;
}) {
  const iconColor = useIconColorStore(state => iconColorCss(state.colors[iconColorKey('session', s.id)]));
  const historical = s.status === 'historical';
  const closedDate = historical && s.closed_at ? new Date(s.closed_at).toLocaleString(undefined,
    { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : null;
  const commandCount = sessionCommandCount(s);
  const subtitle = [
    ...sessionHistoryDirectories(s).map(directory => directory.title),
    commandCount === null ? null : t('{{count}} command blocks', { count: commandCount }),
    closedDate ? t('Closed {{date}}', { date: closedDate }) : t('Active'),
    note ? t('Note: {{note}}', { note }) : null,
  ].filter(Boolean).join(' · ');
  const icon = isSshSession(s) ? <ServerSmall size={16} aria-hidden="true" />
    : historical ? <HistorySmall size={16} aria-hidden="true" /> : <MonitorSmall size={16} aria-hidden="true" />;

  return <SidebarItem
    icon={<span className="history-row-icon" style={{ color: iconColor }}>{icon}</span>}
    title={s.title || t('Untitled session')}
    subtitle={subtitle}
    subtitleFontFamily="var(--font-ui)"
    variant="history"
    compact
    badge={starred || locked ? <span className="history-row-flags">
      {locked && <span className="history-row-lock" data-tip={t('Locked record')}><Lock size={16} aria-hidden="true" /></span>}
      {starred && <span className="history-row-star" data-tip={t('Starred')} data-testid={`session-star-${s.id}`}><Star size={16} aria-hidden="true" /></span>}
    </span> : undefined}
    active={false}
    tabIndex={0}
    testId={`history-session-${s.id}`}
    tooltip={historical ? t('Restore session') : t('Open session')}
    onClick={onOpen}
    leadingActions={historical ? [
      { icon: <X size={16} aria-hidden="true" />, label: t('Delete this session'),
        title: t(locked ? 'Locked record' : 'Delete this session'), disabled: locked || busy,
        testId: `session-delete-${s.id}`, onClick: onDelete },
      { icon: <Undo2 size={16} aria-hidden="true" />, label: t('Restore session'), disabled: busy,
        testId: `session-restore-${s.id}`, onClick: onOpen },
    ] : undefined}
    onContextMenu={event => {
      event.preventDefault(); event.stopPropagation();
      onMenu({ x: event.clientX, y: event.clientY, trigger: event.currentTarget });
    }}
    onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onOpen(); } }}
    action={{
      icon: <Ellipsis size={16} aria-hidden="true" />,
      label: t('More actions'),
      title: t('More actions'),
      testId: `session-menu-${s.id}`,
      onClick: event => {
        const rect = event.currentTarget.getBoundingClientRect();
        onMenu({ x: rect.right - 180, y: rect.bottom + 4, trigger: event.currentTarget });
      },
    }}
  />;
}
