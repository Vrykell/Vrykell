import { useEffect, useMemo, useState } from 'react';
import { ask } from '@tauri-apps/plugin-dialog';
import { t } from '@i18n';
import {
  Ellipsis, Filter, Grid, History, LockSmall as Lock,
  StarSmall, Undo2, X, ArrowSort, Bot, ChevronDown, iconSizes,
} from '@ui/icons';
import { IconButton } from '@ui/actions/IconButton';
import ReloadButton from '@ui/actions/ReloadButton';
import { OutlineButton } from '@ui/actions/OutlineButton';
import HistoryPage from '@ui/history/HistoryPage';
import HistoryGroupCard from '@ui/history/HistoryGroupCard';
import HistoryOptionMenu, { type HistoryMenuSection } from '@ui/history/HistoryOptionMenu';
import ContextMenu, { type ContextMenuItem, type MenuAnchor } from '@ui/menus/ContextMenu';
import ErrorBox from '@ui/feedback/ErrorBox';
import FilterChip from '@ui/menus/FilterChip';
import HistoryTextPrompt from '@ui/history/HistoryTextPrompt';
import SidebarItem from '@ui/layout/sidebarItem';
import { useChatStore } from '@features/chat';
import { useWorkspaceNavigation, type HistoryTypePreset } from '@features/workspace';
import HistoryTerminalIcon from './HistoryTerminalIcon';
import AppMark from '@ui/icons/AppMark';
import IconCountBadge from '@ui/feedback/IconCountBadge';
import HistoryMemberIcon from './HistoryMemberIcon';
import { harnessMark } from '@features/agent/components/HarnessBadge';
import { historyGroupKey, scopedGroupIds, useHistoryMetaStore } from '@utils/historyMeta';
import { isHistoryGroupColor } from '@ui/history/historyGroupColor';
import { useUnifiedHistory } from '../hooks/useUnifiedHistory';
import { SESSION_DATE_OPTIONS, SESSION_MODE_OPTIONS } from '../model/sessionHistoryModel';
import {
  HISTORY_TYPES, UNIFIED_GROUP_BY_OPTIONS, UNIFIED_SORT_OPTIONS,
  groupUnifiedHistory, unifiedHistoryGroupIdentity, type UnifiedHistoryFilter, type UnifiedHistoryGroup, type UnifiedHistoryRecord,
} from '../model/unifiedHistory';
import { sessionSummaryText } from '../model/sessionHistoryModel';
import { conversationMarkdown } from '@features/chat/model/conversationHistory';
import * as conversationApi from '@platform/api/conversation';
import { writeClipboardText } from '@platform/clipboard';
import { useToastStore } from '@ui/feedback/Toast';
import type { WorkspaceHistoryMember } from '@features/workspace/model/workspaceHistory';

const TYPE_LABELS = { all: 'All', terminal: 'Terminal history', conversation: 'AI conversations' } as const;
const DATE_FIELD_LABELS = { activity: 'Latest activity', created: 'Created date' } as const;
const openLabel = (record: UnifiedHistoryRecord) => t(record.kind === 'workspace' ? 'Restore workspace combination' : record.kind === 'terminal' ? 'Restore session' : record.kind === 'agent' ? 'Resume ACP session' : 'Open conversation');
const deleteLabel = (record: UnifiedHistoryRecord) => t(record.kind === 'workspace' ? 'Forget workspace combination' : record.kind === 'terminal' ? 'Delete this session' : record.kind === 'agent' ? 'Forget ACP session reference' : 'Delete conversation');
const anchorFrom = (trigger: HTMLButtonElement, align: 'start' | 'end' = 'start'): MenuAnchor => {
  const rect = trigger.getBoundingClientRect();
  return { x: align === 'end' ? rect.right : rect.left, y: rect.bottom + 4, trigger };
};

/** Complete chronological history surface with the same organization model for every record type. */
export default function UnifiedHistoryView({ preset, destination }: { preset?: HistoryTypePreset; destination?: 'native' | 'unified' } = {}) {
  const history = useUnifiedHistory(preset, destination);
  const historyPreset = useWorkspaceNavigation(state => state.historyPreset);
  const historyPresetRevision = useWorkspaceNavigation(state => state.historyPresetRevision);
  const [filterMenu, setFilterMenu] = useState<MenuAnchor | null>(null);
  const [sortMenu, setSortMenu] = useState<MenuAnchor | null>(null);
  const [groupMenu, setGroupMenu] = useState<MenuAnchor | null>(null);
  const [actionsMenu, setActionsMenu] = useState<MenuAnchor | null>(null);
  const [rowMenu, setRowMenu] = useState<{ record: UnifiedHistoryRecord; anchor: MenuAnchor } | null>(null);
  const [notePrompt, setNotePrompt] = useState<{ record: UnifiedHistoryRecord; anchor: MenuAnchor } | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);
  const notes = useHistoryMetaStore(state => state.notes);
  const lockedRecords = useHistoryMetaStore(state => state.lockedRecords);
  const pinnedGroups = useHistoryMetaStore(state => state.pinnedGroups);
  const groupTitles = useHistoryMetaStore(state => state.groupTitles);
  const groupNotes = useHistoryMetaStore(state => state.groupNotes);
  const collapsedGroups = useHistoryMetaStore(state => state.collapsedGroups);
  const groupColors = useHistoryMetaStore(state => state.groupColors);
  const starred = useHistoryMetaStore(state => state.starred);
  const meta = useHistoryMetaStore.getState();
  const activeConversationId = useChatStore(state => state.activeConversationId);
  const sendingIds = useChatStore(state => state.sendingTabs);

  useEffect(() => {
    history.setFilter({ type: preset ?? historyPreset });
  }, [preset, historyPresetRevision]);

  const pinnedIds = useMemo(() => scopedGroupIds(pinnedGroups, 'session', `unified-${history.filter.groupBy}`),
    [history.filter.groupBy, pinnedGroups]);
  const originalPinnedIds = useMemo(() => scopedGroupIds(pinnedGroups, 'session', 'original'), [pinnedGroups]);
  const originalGroupIds = useMemo(() => new Set(history.originalGroups.map(group => group.id)), [history.originalGroups]);
  const groups = useMemo(() => groupUnifiedHistory(history.visible.filter(record =>
    record.kind !== 'terminal' || !record.session.group_id || !originalGroupIds.has(record.session.group_id)), history.filter.groupBy, pinnedIds, {
    groupTitles, groupNotes, collapsedGroups,
  }), [collapsedGroups, groupNotes, groupTitles, history.filter.groupBy, history.visible, originalGroupIds, pinnedIds]);
  const originalCards = useMemo(() => history.filter.type === 'conversation' ? [] : history.originalGroups.map(group => {
    const all = history.records.filter(record => record.kind === 'terminal' && record.session.group_id === group.id);
    const visible = history.visible.filter(record => record.kind === 'terminal' && record.session.group_id === group.id);
    return { group, all, visible };
  }).filter(card => card.visible.length > 0), [history.filter.type, history.originalGroups, history.records, history.visible]);

  const filtered = history.filter.type !== 'all' || history.filter.connection !== 'all' || history.filter.date !== 'all' || history.filter.mode !== 'all'
    || history.filter.starredOnly || history.filter.groupBy !== 'day' || history.filter.sort !== 'activity-desc' || history.filter.layout && history.filter.layout !== 'all';
  const hasNarrowingFilter = history.filter.connection !== 'all' || history.filter.date !== 'all' || history.filter.mode !== 'all'
    || history.filter.starredOnly || history.filter.layout && history.filter.layout !== 'all';
  const closeSharedMenus = () => { setFilterMenu(null); setSortMenu(null); setGroupMenu(null); setActionsMenu(null); };
  const setFilter = (patch: Partial<UnifiedHistoryFilter>) => {
    const dateField = patch.sort && !patch.sort.startsWith('title')
      ? patch.sort.startsWith('created') ? 'created' : 'activity' : undefined;
    history.setFilter(dateField ? { ...patch, dateField } : patch);
  };

  const recordText = async (record: UnifiedHistoryRecord) => record.kind === 'terminal'
    ? sessionSummaryText(record.session)
    : record.kind === 'workspace' ? JSON.stringify(record.snapshot, null, 2) : record.kind === 'agent' ? JSON.stringify(record.agent, null, 2)
      : conversationMarkdown(record.conversation, await conversationApi.listConversationMessages(record.conversation.id));
  const copyRecords = async (records: readonly UnifiedHistoryRecord[]) => {
    try {
      const entries = await Promise.all(records.map(recordText));
      await writeClipboardText(entries.join('\n\n---\n\n'));
      useToastStore.getState().addToast(t('Copied'), 'success');
    } catch {
      useToastStore.getState().addToast(t('Copy failed'), 'error');
    }
  };
  const deletable = (records: readonly UnifiedHistoryRecord[]) => records.filter(record =>
    !lockedRecords[record.key] && !(record.kind === 'conversation' && sendingIds.includes(record.conversation.id)));
  const deleteRecords = async (records: readonly UnifiedHistoryRecord[]) => {
    const targets = deletable(records);
    if (!targets.length || batchBusy) return;
    const ok = await ask(t(targets.every(record => record.kind === 'workspace')
      ? 'Forget {{count}} workspace combinations? Their sessions and documents are kept.' : targets.some(record => record.kind === 'agent')
      ? 'Delete {{count}} matching records? ACP references are only forgotten; their agent-owned history is kept. Locked and working records are excluded.'
      : 'Delete {{count}} matching records and their history? Locked and working records are excluded.', {
      count: targets.length,
    }), { title: t('Delete history records'), kind: 'warning' });
    if (!ok) return;
    setBatchBusy(true);
    try {
      await history.removeMany(targets);
    } finally {
      setBatchBusy(false);
    }
  };
  const openRecords = (records: readonly UnifiedHistoryRecord[]) => {
    void history.openMany(records);
  };
  const completeGroup = async (id: string | null, original: boolean, matching: boolean, apply: (records: UnifiedHistoryRecord[]) => unknown) => {
    if (batchBusy) return;
    setBatchBusy(true);
    try {
      const all = await history.collect(matching);
      const targets = id === null ? all : all.filter(record => original ? record.kind === 'terminal' && record.session.group_id === id : unifiedHistoryGroupIdentity(record, history.filter.groupBy).id === id);
      setBatchBusy(false);
      await apply(targets);
    } catch (reason) { useToastStore.getState().addToast(String(reason), 'error'); }
    finally { setBatchBusy(false); }
  };
  const toggleGroups = (value: boolean) => {
    const keys = groups.map(group => historyGroupKey('session', `unified-${history.filter.groupBy}`, group.id));
    meta.setGroupsCollapsed(keys, value);
  };
  const groupKey = (group: UnifiedHistoryGroup) => historyGroupKey('session', `unified-${history.filter.groupBy}`, group.id);
  const groupItems = (group: UnifiedHistoryGroup): ContextMenuItem[] => [
    { label: t('Open matching records'), disabled: batchBusy || !group.records.length, onClick: () => void completeGroup(group.id, false, true, openRecords) },
    { label: t('Copy matching records'), group: 'clipboard', disabled: !group.records.length, onClick: () => void completeGroup(group.id, false, true, copyRecords) },
    { label: t('Delete matching records…'), danger: true, disabled: batchBusy || !deletable(group.records).length, onClick: () => void completeGroup(group.id, false, true, deleteRecords) },
  ];
  const pageGroupItems: ContextMenuItem[] = [
    { label: t('Expand all groups'), group: 'view', disabled: !groups.some(group => collapsedGroups[groupKey(group)]), onClick: () => toggleGroups(false) },
    { label: t('Collapse all groups'), group: 'view', disabled: !groups.some(group => !collapsedGroups[groupKey(group)]), onClick: () => toggleGroups(true) },
  ];

  const filterSections: HistoryMenuSection[] = [
    { label: t('Type'), options: HISTORY_TYPES.map(type => ({
      label: t(TYPE_LABELS[type]), active: history.filter.type === type, onSelect: () => setFilter({ type }),
    })) },
    { label: t('Connection type'), options: [
      { label: t('All'), active: history.filter.connection === 'all', onSelect: () => setFilter({ connection: 'all' }) },
      { label: t('Local'), active: history.filter.connection === 'local', onSelect: () => setFilter({ connection: 'local' }) },
      { label: t('SSH'), active: history.filter.connection === 'ssh', onSelect: () => setFilter({ connection: 'ssh' }) },
      { label: t('Discussion only'), active: history.filter.connection === 'discussion',
        onSelect: () => setFilter({ connection: 'discussion' }) },
    ] },
    { label: t('Layout'), options: (['all', 'single', 'split'] as const).map(layout => ({
      label: t(layout === 'all' ? 'All layouts' : layout === 'split' ? 'Split layouts' : 'Single pane'),
      active: (history.filter.layout ?? 'all') === layout, onSelect: () => setFilter({ layout }),
    })) },
    { label: t('Terminal startup mode'), options: SESSION_MODE_OPTIONS.map(option => ({
      label: t(option.label), active: history.filter.mode === option.value, onSelect: () => setFilter({ mode: option.value }),
    })) },
    { label: t('Date field'), options: (['activity', 'created'] as const).map(value => ({
      label: t(DATE_FIELD_LABELS[value]), active: history.filter.dateField === value, onSelect: () => setFilter({ dateField: value }),
    })) },
    { label: t(history.filter.dateField === 'created' ? 'Created date' : 'Latest activity'), options: SESSION_DATE_OPTIONS.map(option => ({
      label: t(option.label), active: history.filter.date === option.value, onSelect: () => setFilter({ date: option.value }),
    })) },
    { label: t('Favorites'), options: [{ label: t('Starred only'), active: history.filter.starredOnly,
      onSelect: () => setFilter({ starredOnly: !history.filter.starredOnly }) }] },
  ];
  const sortSections: HistoryMenuSection[] = [{ label: t(history.filter.groupBy === 'none' ? 'Sort records' : 'Sort within groups'),
    options: UNIFIED_SORT_OPTIONS.map(option => ({ label: t(option.label), active: history.filter.sort === option.value,
      onSelect: () => setFilter({ sort: option.value }) })) }];
  const groupSections: HistoryMenuSection[] = [{ label: t('Group by'), options: UNIFIED_GROUP_BY_OPTIONS.map(option => ({
    label: t(option.label), active: history.filter.groupBy === option.value, onSelect: () => setFilter({ groupBy: option.value }),
  })) }];

  const rowMenuItems: ContextMenuItem[] = rowMenu ? [
    { label: openLabel(rowMenu.record), onClick: () => history.open(rowMenu.record) },
    { label: t(rowMenu.record.kind === 'terminal' || rowMenu.record.kind === 'workspace' ? 'Copy summary' : rowMenu.record.kind === 'agent' ? 'Copy session reference' : 'Copy as Markdown'), group: 'clipboard',
      onClick: () => void copyRecords([rowMenu.record]) },
    { label: t(notes[rowMenu.record.key] ? 'Edit note…' : 'Add note…'), group: 'edit',
      onClick: () => { setNotePrompt({ record: rowMenu.record, anchor: rowMenu.anchor }); setRowMenu(null); } },
    { label: t(rowMenu.record.starred ? 'Unstar' : 'Star'), group: 'view',
      onClick: () => meta.toggleStar(rowMenu.record.key) },
    { label: t(lockedRecords[rowMenu.record.key] ? 'Unlock record' : 'Lock record'), group: 'organize',
      onClick: () => meta.setLocked([rowMenu.record.key], !lockedRecords[rowMenu.record.key]) },
    { label: deleteLabel(rowMenu.record), danger: true,
      disabled: Boolean(lockedRecords[rowMenu.record.key]) || rowMenu.record.kind === 'conversation' && sendingIds.includes(rowMenu.record.conversation.id),
      onClick: () => void deleteRecords([rowMenu.record]) },
  ] : [];

  const activeFilterCards = history.filter.type !== 'all' || history.filter.connection !== 'all' || history.filter.mode !== 'all'
    || history.filter.date !== 'all' || history.filter.starredOnly || history.filter.layout && history.filter.layout !== 'all';
  const pageTitle = history.filter.type === 'terminal' ? 'Session history'
    : history.filter.type === 'conversation' ? 'AI conversation history' : 'All history';
  const searchLabel = history.filter.type === 'terminal' ? 'Search sessions'
    : history.filter.type === 'conversation' ? 'Search conversations' : 'Search all history';
  const searchPlaceholder = history.filter.type === 'terminal' ? 'Search sessions…'
    : history.filter.type === 'conversation' ? 'Search conversations…' : 'Search terminals and AI conversations…';

  return <HistoryPage pageTestId="unified-history-page" listLabel={t(pageTitle)} icon={<History size={iconSizes.control} />}
    title={t(pageTitle)} count={t(history.hasMore ? '{{count}} loaded records' : '{{count}} records', { count: history.visible.length })} busy={history.loading || batchBusy}
    onLoadMore={() => { if (history.hasMore && !history.loadingMore && !history.loading && !history.conversationError) void history.loadMore(); }}
    query={history.filter.query} onQueryChange={query => setFilter({ query })}
    searchLabel={t(searchLabel)} searchPlaceholder={t(searchPlaceholder)} searchTestId="unified-history-search"
    filterChips={activeFilterCards ? <>
      {history.filter.layout && history.filter.layout !== 'all' && <FilterChip removeLabel={t('Remove layout filter')}
        onRemove={() => setFilter({ layout: 'all' })}>{t(history.filter.layout === 'split' ? 'Split layouts' : 'Single pane')}</FilterChip>}
      {history.filter.type !== 'all' && <FilterChip testId="unified-history-filter-card-type" removeLabel={t('Remove filter: {{filter}}', {
        filter: t(TYPE_LABELS[history.filter.type]),
      })} onRemove={() => setFilter({ type: 'all' })}>{t(TYPE_LABELS[history.filter.type])}</FilterChip>}
      {history.filter.connection !== 'all' && <FilterChip testId="unified-history-filter-card-connection" removeLabel={t('Remove filter: {{filter}}', {
        filter: history.filter.connection === 'local' ? t('Local') : history.filter.connection === 'ssh' ? t('SSH') : t('Discussion only'),
      })} onRemove={() => setFilter({ connection: 'all' })}>
        {history.filter.connection === 'local' ? t('Local') : history.filter.connection === 'ssh' ? t('SSH') : t('Discussion only')}
      </FilterChip>}
      {history.filter.mode !== 'all' && <FilterChip testId="unified-history-filter-card-mode" removeLabel={t('Remove filter: {{filter}}', {
        filter: t(SESSION_MODE_OPTIONS.find(option => option.value === history.filter.mode)?.label ?? history.filter.mode),
      })} onRemove={() => setFilter({ mode: 'all' })}>
        {t(SESSION_MODE_OPTIONS.find(option => option.value === history.filter.mode)?.label ?? history.filter.mode)}
      </FilterChip>}
      {history.filter.date !== 'all' && <FilterChip testId="unified-history-filter-card-date" removeLabel={t('Remove filter: {{filter}}', {
        filter: t(SESSION_DATE_OPTIONS.find(option => option.value === history.filter.date)?.label ?? history.filter.date),
      })} onRemove={() => setFilter({ date: 'all' })}>
        {t(SESSION_DATE_OPTIONS.find(option => option.value === history.filter.date)?.label ?? history.filter.date)}
      </FilterChip>}
      {history.filter.starredOnly && <FilterChip testId="unified-history-filter-card-starred" removeLabel={t('Remove filter: {{filter}}', {
        filter: t('Starred only'),
      })} onRemove={() => setFilter({ starredOnly: false })}>{t('Starred only')}</FilterChip>}
    </> : undefined}
    headerActions={<>
      <IconButton compact className="history-icon-button history-toolbar-secondary" aria-label={t('Filter history')} data-tip={t('Filter history')}
        data-active={filtered || undefined} aria-haspopup="menu" aria-expanded={!!filterMenu} data-testid="unified-history-filter"
        onClick={event => { closeSharedMenus(); setFilterMenu(anchorFrom(event.currentTarget)); }}><Filter size={iconSizes.control} /></IconButton>
      <IconButton compact className="history-icon-button history-toolbar-secondary" aria-label={t('Sort history')} data-tip={t('Sort history')}
        data-active={history.filter.sort !== 'activity-desc' || undefined} aria-haspopup="menu" aria-expanded={!!sortMenu}
        data-testid="unified-history-sort" onClick={event => { closeSharedMenus(); setSortMenu(anchorFrom(event.currentTarget, 'end')); }}>
        <ArrowSort size={iconSizes.control} />
      </IconButton>
      <IconButton compact className="history-icon-button history-toolbar-secondary" aria-label={t('Group by')} data-tip={t('Group by')}
        data-active={history.filter.groupBy !== 'day' || undefined} aria-haspopup="menu" aria-expanded={!!groupMenu}
        data-testid="unified-history-group-by" onClick={event => { closeSharedMenus(); setGroupMenu(anchorFrom(event.currentTarget, 'end')); }}>
        <Grid size={iconSizes.control} />
      </IconButton>
      <span className="history-toolbar-secondary"><ReloadButton compact label={t('Refresh history')} busy={history.loading || batchBusy} onReload={history.refresh} /></span>
      <IconButton compact className="history-icon-button" aria-label={t('More actions')} data-tip={t('More actions')}
        aria-haspopup="menu" aria-expanded={!!actionsMenu} data-testid="unified-history-actions"
        onClick={event => { closeSharedMenus(); setActionsMenu(anchorFrom(event.currentTarget)); }}><Ellipsis size={iconSizes.control} /></IconButton>
    </>}
    overlays={<>
      {filterMenu && <HistoryOptionMenu anchor={filterMenu} testId="unified-history-filter-menu" sections={filterSections}
        onClose={() => setFilterMenu(null)} width={184} maxHeight={420} />}
      {sortMenu && <HistoryOptionMenu anchor={sortMenu} testId="unified-history-sort-menu" sections={sortSections}
        onClose={() => setSortMenu(null)} width={184} maxHeight={300} align="end" closeOnSelect />}
      {groupMenu && <HistoryOptionMenu anchor={groupMenu} testId="unified-history-group-menu" sections={groupSections}
        onClose={() => setGroupMenu(null)} width={184} maxHeight={360} align="end" closeOnSelect />}
      {rowMenu && <ContextMenu anchor={rowMenu.anchor} itemRole="menuitem" items={rowMenuItems} onClose={() => setRowMenu(null)} />}
      {notePrompt && <HistoryTextPrompt anchor={notePrompt.anchor} label={t('Note')} placeholder={t('Write a note…')}
        value={notes[notePrompt.record.key] ?? ''} multiline saveLabel={t('Save')}
        testId={`unified-history-note-${notePrompt.record.key}`}
        onSave={text => meta.setNote(notePrompt.record.key, text)} onClose={() => setNotePrompt(null)} />}
      {actionsMenu && <ContextMenu anchor={actionsMenu} itemRole="menuitem" onClose={() => setActionsMenu(null)} items={[
        { label: t('Filter history'), onClick: () => setFilterMenu(anchorFrom(document.querySelector<HTMLButtonElement>('[data-testid="unified-history-filter"]')!)) },
        { label: t('Sort history'), onClick: () => setSortMenu(anchorFrom(document.querySelector<HTMLButtonElement>('[data-testid="unified-history-sort"]')!, 'end')) },
        { label: t('Group by'), onClick: () => setGroupMenu(anchorFrom(document.querySelector<HTMLButtonElement>('[data-testid="unified-history-group-by"]')!, 'end')) },
        { label: t('Refresh history'), disabled: history.loading || batchBusy, onClick: () => void history.refresh() },
        { label: t('Open matching records'), disabled: batchBusy || !history.visible.length, onClick: () => void completeGroup(null, false, true, openRecords) },
        { label: t('Copy matching records'), group: 'clipboard', disabled: batchBusy || !history.visible.length, onClick: () => void completeGroup(null, false, true, copyRecords) },
        { label: t('Delete matching records…'), danger: true, disabled: batchBusy || !deletable(history.visible).length,
          onClick: () => void completeGroup(null, false, true, deleteRecords) },
        ...pageGroupItems,
        { label: t('Clear filters'), group: 'view', disabled: !filtered, onClick: () => history.resetFilter() },
      ]} />}
    </>}>
    {history.terminalError && <ErrorBox title={t(pageTitle)} actions={<OutlineButton onClick={() => void history.refresh()}>{t('Retry')}</OutlineButton>}>{history.terminalError}</ErrorBox>}
    {history.conversationError && history.conversationError !== history.terminalError && <ErrorBox title={t('AI conversation history')} actions={<OutlineButton onClick={() => void history.refresh()}>{t('Retry')}</OutlineButton>}>{history.conversationError}</ErrorBox>}
    {!history.visible.length && !history.loading && !history.terminalError && !history.conversationError && <div className="history-empty"><History size={24} />
      <span>{t(history.filter.query || hasNarrowingFilter ? 'No matching history' : 'No history yet')}</span></div>}
    {originalCards.map(({ group, all, visible }) => {
      const key = historyGroupKey('session', 'original', group.id);
      const keys = visible.map(record => record.key);
      const workingDirectories = new Set(all.map(record => record.cwd).filter(Boolean));
      const allStarred = keys.length > 0 && keys.every(recordKey => starred[recordKey]);
      const lockedCount = keys.filter(recordKey => lockedRecords[recordKey]).length;
      const allLocked = keys.length > 0 && lockedCount === keys.length;
      return <HistoryGroupCard key={`original:${group.id}`} id={`source:${group.id}`}
        title={groupTitles[key] ?? group.title} originalTitle={group.title}
        subtitle={history.filter.groupBy === 'cwd' && workingDirectories.size > 1
          ? `${t('Original tab group')} · ${t('Multiple working directories')}` : t('Original tab group')}
        count={history.hasMore ? t('{{count}} loaded records', { count: all.length }) : t('{{matching}} of {{total}} sessions', { matching: visible.length, total: all.length })}
        timestamp={Math.max(...visible.map(record => record.timestamp))}
        pinned={originalPinnedIds.has(group.id)} color={isHistoryGroupColor(groupColors[key]) ? groupColors[key] : undefined}
        collapsed={Boolean(collapsedGroups[key])} onCollapsedChange={value => meta.setGroupsCollapsed([key], value)}
        onTogglePin={() => meta.togglePinnedGroup(key)} onSelectColor={value => meta.setGroupColor(key, value)}
        note={groupNotes[key]} onRename={value => {
          if (value.trim() === group.title) meta.setGroupTitle(key, null);
          else void history.renameOriginalGroup(group.id, value);
        }} onNote={value => meta.setGroupNote(key, value)} lockedCount={lockedCount}
        actions={[
          { label: t('Restore matching'), disabled: batchBusy || history.busy || !visible.length, onClick: () => void completeGroup(group.id, true, true, openRecords) },
          { label: t('Restore group'), disabled: batchBusy || history.busy || !all.length, onClick: () => void completeGroup(group.id, true, false, openRecords) },
          { label: history.hasMore ? t('Restore original group') : t('Restore original group ({{count}} sessions)', { count: all.length }), disabled: batchBusy || history.busy || !all.length,
            onClick: () => void completeGroup(group.id, true, false, openRecords) },
          { label: t('Copy matching records'), group: 'clipboard', disabled: !visible.length, onClick: () => void completeGroup(group.id, true, true, copyRecords) },
          { label: t('Delete matching records…'), danger: true, disabled: batchBusy || history.busy || !deletable(visible).length,
            onClick: () => void completeGroup(group.id, true, true, deleteRecords) },
        ]}
        recordActions={[
          { label: t(allStarred ? 'Unstar matching records' : 'Star matching records'), group: 'view', disabled: !keys.length,
            onClick: () => void completeGroup(group.id, true, true, records => meta.setStarred(records.map(record => record.key), !allStarred)) },
          { label: t('Lock matching records'), group: 'organize', disabled: !keys.length || allLocked,
            onClick: () => void completeGroup(group.id, true, true, records => meta.setLocked(records.map(record => record.key), true)) },
          { label: t('Unlock matching records'), group: 'organize', disabled: !lockedCount,
            onClick: () => void completeGroup(group.id, true, true, records => meta.setLocked(records.map(record => record.key), false)) },
        ]}>
        {visible.map(record => <UnifiedHistoryRow key={record.key} record={record} active={false}
          locked={Boolean(lockedRecords[record.key])} busy={history.busy || batchBusy}
          onOpen={() => history.open(record)} onDelete={() => void deleteRecords([record])}
          onMenu={anchor => setRowMenu({ record, anchor })} onOpenMember={history.openMember} />)}
      </HistoryGroupCard>;
    })}
    {groups.map(group => {
      const key = groupKey(group);
      const keys = group.records.map(record => record.key);
      const allStarred = keys.length > 0 && keys.every(recordKey => starred[recordKey]);
      const lockedCount = keys.filter(recordKey => lockedRecords[recordKey]).length;
      const allLocked = keys.length > 0 && lockedCount === keys.length;
      return <HistoryGroupCard key={group.id} id={`${history.filter.groupBy}:${group.id}`}
        title={group.title} originalTitle={group.originalTitle} subtitle={group.subtitle}
        count={t(history.hasMore ? '{{count}} loaded records' : '{{count}} records', { count: group.records.length })} timestamp={group.timestamp}
        pinned={pinnedIds.has(group.id)} color={isHistoryGroupColor(groupColors[key]) ? groupColors[key] : undefined}
        collapsed={Boolean(collapsedGroups[key])} onCollapsedChange={value => meta.setGroupsCollapsed([key], value)}
        onTogglePin={() => meta.togglePinnedGroup(key)} onSelectColor={value => meta.setGroupColor(key, value)}
        note={groupNotes[key]} onRename={value => meta.setGroupTitle(key, value.trim() === group.originalTitle ? null : value)}
        onNote={value => meta.setGroupNote(key, value)} lockedCount={lockedCount}
        actions={groupItems(group)} recordActions={[
          { label: t(allStarred ? 'Unstar matching records' : 'Star matching records'), group: 'view', disabled: !keys.length,
            onClick: () => void completeGroup(group.id, false, true, records => meta.setStarred(records.map(record => record.key), !allStarred)) },
          { label: t('Lock matching records'), group: 'organize', disabled: !keys.length || allLocked,
            onClick: () => void completeGroup(group.id, false, true, records => meta.setLocked(records.map(record => record.key), true)) },
          { label: t('Unlock matching records'), group: 'organize', disabled: !lockedCount,
            onClick: () => void completeGroup(group.id, false, true, records => meta.setLocked(records.map(record => record.key), false)) },
        ]}>
        {group.records.map(record => <UnifiedHistoryRow key={record.key} record={record}
          active={record.kind === 'conversation' && readingActive(record, activeConversationId)}
          locked={Boolean(lockedRecords[record.key])}
          busy={history.busy || batchBusy || record.kind === 'conversation' && sendingIds.includes(record.conversation.id)}
          onOpen={() => history.open(record)} onDelete={() => void deleteRecords([record])}
          onMenu={anchor => setRowMenu({ record, anchor })} onOpenMember={history.openMember} />)}
      </HistoryGroupCard>;
    })}
    {history.hasMore && <div className="history-pagination"><OutlineButton disabled={history.loadingMore} onClick={() => void history.loadMore()}>{t(history.loadingMore ? 'Loading more history…' : 'Load more history')}</OutlineButton></div>}
  </HistoryPage>;
}

function readingActive(record: UnifiedHistoryRecord, activeId: string | null) {
  return record.kind === 'conversation' && record.conversation.id === activeId;
}

function UnifiedHistoryRow({ record, active, locked, busy, onOpen, onDelete, onMenu, onOpenMember }: {
  record: UnifiedHistoryRecord; active: boolean; locked: boolean; busy: boolean;
  onOpen: () => void; onDelete: () => void; onMenu: (anchor: MenuAnchor) => void;
  onOpenMember: (member: WorkspaceHistoryMember) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const label = t(record.kind === 'workspace' ? 'Workspace combination' : record.kind === 'conversation' ? 'AI conversation' : record.kind === 'agent' ? 'ACP session reference' : record.local && record.ssh ? 'Mixed connections' : record.ssh ? 'SSH terminal' : 'Local terminal');
  const AgentMark = record.kind === 'agent' ? harnessMark(record.agent.harness, Bot) : Bot;
  const activity = t(record.kind === 'conversation' ? 'Updated {{date}}' : record.kind === 'agent' ? 'Last opened {{date}}' : 'Closed {{date}}', {
    date: new Date(record.timestamp).toLocaleString(undefined, {
      year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
    }),
  });
  return <><SidebarItem variant="history" compact active={active} title={record.title || t(record.kind === 'conversation' ? 'New conversation' : 'Untitled session')}
    icon={<span className="history-row-icon"><IconCountBadge count={record.paneCount}>{record.kind === 'workspace' ? <HistoryMemberIcon member={record.snapshot.members[0]!} size={iconSizes.control} /> : record.kind === 'conversation' ? <AppMark size={iconSizes.control} /> : record.kind === 'agent' ? <AgentMark size={iconSizes.control} /> : <HistoryTerminalIcon session={record.session} size={iconSizes.control} />}</IconCountBadge></span>}
    subtitle={[label, record.paneCount > 1 && t('{{count}} panes', { count: record.paneCount }), record.kind === 'workspace' && record.types.map(type => t(TYPE_LABELS[type])).join(' + '), record.cwd || record.description, activity, record.note]
      .filter(Boolean).join(' · ')} subtitleFontFamily="var(--font-ui)"
    trailingActions={record.kind === 'workspace' ? [{ label: t(expanded ? 'Hide panes' : 'Show panes'), control: <IconButton compact
      aria-label={t(expanded ? 'Hide panes' : 'Show panes')} aria-expanded={expanded} aria-controls={`history-panes-${record.key}`} onClick={event => { event.stopPropagation(); setExpanded(value => !value); }}>
      <ChevronDown size={16} style={{ transform: expanded ? 'rotate(180deg)' : undefined }} /></IconButton> }] : undefined}
    badge={record.starred || locked ? <span className="history-row-flags">
      {locked && <span className="history-row-lock" data-tip={t('Locked record')}><Lock size={16} aria-hidden="true" /></span>}
      {record.starred && <span className="history-row-star" data-tip={t('Starred')}>
        <StarSmall size={iconSizes.compact} color="var(--favorite-color)" aria-hidden="true" />
      </span>}
    </span> : undefined}
    leadingActions={[
      { icon: <X size={iconSizes.compact} />, label: deleteLabel(record),
        title: locked ? t('Locked record') : deleteLabel(record),
        disabled: locked || busy, onClick: onDelete, testId: `unified-history-delete-${record.key}` },
      { icon: <Undo2 size={iconSizes.compact} />, label: openLabel(record),
        disabled: busy, onClick: onOpen, testId: `unified-history-open-${record.key}` },
    ]}
    testId={`unified-history-${record.key}`} dataAttributes={{ role: 'button', 'data-history-kind': record.kind }} tabIndex={0}
    onContextMenu={event => { event.preventDefault(); event.stopPropagation(); onMenu({ x: event.clientX, y: event.clientY, trigger: event.currentTarget }); }}
    onClick={onOpen} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen(); } }}
    action={{ icon: <Ellipsis size={iconSizes.control} />, label: t('More actions'), title: t('More actions'),
      testId: `unified-history-menu-${record.key}`, onClick: event => {
        const rect = event.currentTarget.getBoundingClientRect();
        onMenu({ x: rect.right - 180, y: rect.bottom + 4, trigger: event.currentTarget });
      } }} />
    {record.kind === 'workspace' && expanded && <div className="history-combination-members" id={`history-panes-${record.key}`} role="group" aria-label={t('Workspace panes')}>{record.snapshot.members.map(member => {
      return <SidebarItem
      key={member.id} variant="history" compact active={false} title={member.title} subtitle={t(member.kind === 'terminal' ? 'Terminal session' : member.kind === 'agent' ? 'ACP session reference' : member.kind === 'conversation' ? 'AI conversation' : 'File')}
      icon={<IconCountBadge count={member.paneCount}><HistoryMemberIcon member={member} /></IconCountBadge>}
      action={{ icon: <Undo2 size={16} />, label: t('Open this pane'), onClick: () => {
        void onOpenMember(member);
      } }} />; })}</div>}
  </>;
}
