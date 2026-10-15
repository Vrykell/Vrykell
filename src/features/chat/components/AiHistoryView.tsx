import { useEffect, useMemo, useRef, useState } from 'react';
import { ask } from '@tauri-apps/plugin-dialog';
import { t } from '@i18n';
import { ArrowSort, Ellipsis, Filter, Grid, History, LockSmall as Lock, SparklesSmall as Sparkles, StarSmall as Star } from '@ui/icons';
import { IconButton } from '@ui/IconButton';
import ContextMenu, { type ContextMenuItem, type MenuAnchor } from '@ui/ContextMenu';
import HistoryOptionMenu, { type HistoryMenuSection } from '@ui/HistoryOptionMenu';
import HistoryGroupCard from '@ui/HistoryGroupCard';
import HistoryPage from '@ui/HistoryPage';
import HistoryTextPrompt from '@ui/HistoryTextPrompt';
import SidebarItem from '@ui/sidebarItem';
import ErrorBox from '@ui/ErrorBox';
import { useDockStore } from '@features/workspace';
import type { Conversation } from '../model/conversation';
import {
  DEFAULT_CONVERSATION_HISTORY_FILTER,
  CONVERSATION_GROUP_BY_OPTIONS,
  conversationMarkdown,
  filterConversations,
  groupConversations,
  hasConversationHistoryFilter,
  conversationHistoryDateField,
  conversationHistoryTimestamp,
  updateConversationHistoryFilter,
  type ConversationDateFilter,
  type ConversationHistoryGroupBy,
  type ConversationHistoryFilter,
  type ConversationHistorySort,
  type ConversationTypeFilter,
} from '../model/conversationHistory';
import { useChatStore } from '../stores/chat';
import * as conversationApi from '@platform/api/conversation';
import { writeClipboardText } from '@platform/clipboard';
import { historyRecordKey, historySearchAnnotations, scopedIds, useHistoryMetaStore } from '@utils/historyMeta';
import { useHistoryGroupActions } from '@ui/hooks/useHistoryGroupActions';
import { runHistoryBatch } from '@utils/historyBatch';
import { useToastStore } from '@ui/Toast';

const FILTER_KEY = 'vrykell-ai-history-filter';
const TYPE_VALUES: ConversationTypeFilter[] = ['all', 'discussion', 'local', 'ssh'];
const DATE_VALUES: ConversationDateFilter[] = ['all', 'today', '7d', '30d', '90d'];
const SORT_VALUES: ConversationHistorySort[] = [
  'updated-desc', 'updated-asc', 'created-desc', 'created-asc', 'title-asc', 'title-desc',
];
const TYPE_LABELS = {
  all: 'All', discussion: 'Discussion only', local: 'Local', ssh: 'SSH',
} as const satisfies Record<ConversationTypeFilter, string>;
const DATE_LABELS = {
  all: 'All time', today: 'Today', '7d': 'Last 7 days', '30d': 'Last 30 days', '90d': 'Last 90 days',
} as const satisfies Record<ConversationDateFilter, string>;
const SORT_LABELS = {
  'updated-desc': 'Recently updated',
  'updated-asc': 'Earliest updated',
  'created-desc': 'Recently created',
  'created-asc': 'Earliest created',
  'title-asc': 'Title A–Z',
  'title-desc': 'Title Z–A',
} as const satisfies Record<ConversationHistorySort, string>;

function readHistoryFilter(): ConversationHistoryFilter {
  try {
    const raw = sessionStorage.getItem(FILTER_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<ConversationHistoryFilter>;
      return {
        query: typeof saved.query === 'string' ? saved.query : '',
        type: TYPE_VALUES.includes(saved.type as ConversationTypeFilter) ? saved.type! : 'all',
        date: DATE_VALUES.includes(saved.date as ConversationDateFilter) ? saved.date! : 'all',
        sort: SORT_VALUES.includes(saved.sort as ConversationHistorySort) ? saved.sort! : 'updated-desc',
        groupBy: CONVERSATION_GROUP_BY_OPTIONS.some(option => option.value === saved.groupBy)
          ? saved.groupBy! as ConversationHistoryGroupBy : 'day',
        dateField: saved.dateField === 'created' || saved.dateField === 'updated' ? saved.dateField
          : conversationHistoryDateField(SORT_VALUES.includes(saved.sort as ConversationHistorySort) ? saved.sort! : 'updated-desc'),
        starredOnly: saved.starredOnly === true,
      };
    }
  } catch {
    // Unavailable or invalid session storage falls back to the default history view.
  }
  return DEFAULT_CONVERSATION_HISTORY_FILTER;
}

/** The workspace history page owns conversation navigation; the dock keeps the active chat. */
export default function AiHistoryView() {
  const [filter, setFilter] = useState<ConversationHistoryFilter>(readHistoryFilter);
  const [filterMenu, setFilterMenu] = useState<{ x: number; y: number } | null>(null);
  const [sortMenu, setSortMenu] = useState<{ x: number; y: number } | null>(null);
  const [groupMenu, setGroupMenu] = useState<{ x: number; y: number } | null>(null);
  const [actionsMenu, setActionsMenu] = useState<{ x: number; y: number } | null>(null);
  const [rowMenu, setRowMenu] = useState<{ id: string; anchor: MenuAnchor } | null>(null);
  const [notePrompt, setNotePrompt] = useState<{ id: string; anchor: { x: number; y: number } } | null>(null);
  const groupOperations = useHistoryGroupActions('conversation', filter.groupBy);
  const { meta, pinnedIds } = groupOperations;
  const { starred, notes, lockedRecords } = meta;
  const [batchBusy, setBatchBusy] = useState(false);
  const batchBusyRef = useRef(false);
  const conversations = useChatStore(state => state.conversations);
  const activeId = useChatStore(state => state.activeConversationId);
  const sendingId = useChatStore(state => state.sendingTab);
  const loading = useChatStore(state => state.conversationsLoading);
  const loaded = useChatStore(state => state.conversationsLoaded);
  const error = useChatStore(state => state.conversationError);
  useEffect(() => { void useChatStore.getState().loadConversations(); }, []);
  useEffect(() => {
    try {
      sessionStorage.setItem(FILTER_KEY, JSON.stringify(filter));
    } catch { /* Storage is optional. */ }
  }, [filter]);

  const starredIds = useMemo(() => scopedIds(starred, 'conversation'), [starred]);
  const dateField = filter.dateField ?? conversationHistoryDateField(filter.sort);
  const annotations = useMemo(() => historySearchAnnotations('conversation', filter.groupBy,
    groupConversations(conversations, filter.groupBy, filter.sort, dateField)
      .map(group => ({ ...group, recordIds: group.items.map(item => item.id) })), meta),
  [conversations, filter.groupBy, filter.sort, dateField, meta.notes, meta.groupTitles, meta.groupNotes]);
  const visible = useMemo(
    () => filterConversations(conversations, filter, filter.starredOnly ? starredIds : null, annotations),
    [conversations, filter, starredIds, annotations],
  );
  const historyGroups = useMemo(
    () => groupConversations(visible, filter.groupBy, filter.sort, dateField, pinnedIds),
    [visible, filter.groupBy, filter.sort, dateField, pinnedIds],
  );
  const noteKey = (id: string) => historyRecordKey('conversation', id);
  const open = (id: string) => {
    void useChatStore.getState().selectConversation(id);
    useDockStore.getState().openPanel('chat');
  };
  const create = () => {
    useChatStore.getState().createConversation();
    useDockStore.getState().openPanel('chat');
  };
  const remove = async (id: string) => {
    if (useHistoryMetaStore.getState().lockedRecords[noteKey(id)] || batchBusyRef.current) return;
    if (await ask(t('Delete this conversation and its messages?'), { title: t('Delete conversation'), kind: 'warning' })) {
      if (useHistoryMetaStore.getState().lockedRecords[noteKey(id)]) return;
      await useChatStore.getState().deleteConversation(id);
      if (!useChatStore.getState().conversations.some(item => item.id === id)) meta.removeRecords([noteKey(id)]);
    }
  };
  const copyMarkdown = async (items: readonly Conversation[]) => {
    if (batchBusyRef.current) return;
    batchBusyRef.current = true;
    setBatchBusy(true);
    try {
      const sections: string[] = [];
      for (const conversation of items) {
        const records = await conversationApi.listConversationMessages(conversation.id);
        sections.push(conversationMarkdown(conversation, records ?? []));
      }
      await writeClipboardText(sections.join('\n\n---\n\n'));
      useToastStore.getState().addToast(t('Copied'), 'success');
    } catch {
      useToastStore.getState().addToast(t('Copy failed'), 'error');
    } finally {
      batchBusyRef.current = false;
      setBatchBusy(false);
    }
  };
  const deletable = (items: readonly Conversation[]) => items.filter(item => item.id !== useChatStore.getState().sendingTab
    && !useHistoryMetaStore.getState().lockedRecords[noteKey(item.id)]);
  const deleteMatching = async (items: readonly Conversation[]) => {
    const targets = deletable(items);
    if (!targets.length || batchBusyRef.current) return;
    if (!await ask(t('Delete {{count}} matching conversations and their messages? Locked and working conversations are excluded.', { count: targets.length }),
      { title: t('Delete conversations'), kind: 'warning' })) return;
    if (batchBusyRef.current) return;
    batchBusyRef.current = true;
    setBatchBusy(true);
    try {
      const result = await runHistoryBatch(targets, async item => {
        if (!deletable([item]).length) throw new Error('Record is locked or working');
        await useChatStore.getState().deleteConversation(item.id);
        if (useChatStore.getState().conversations.some(current => current.id === item.id)) throw new Error('Record was not deleted');
        meta.removeRecords([noteKey(item.id)]);
      });
      useToastStore.getState().addToast(result.failed.length
        ? t('{{succeeded}} completed; {{failed}} failed', { succeeded: result.succeeded.length, failed: result.failed.length })
        : t('{{count}} conversations deleted', { count: result.succeeded.length }), result.failed.length ? 'error' : 'success');
    } finally {
      batchBusyRef.current = false;
      setBatchBusy(false);
    }
  };
  const groupItems = (items: readonly Conversation[]): ContextMenuItem[] => [
    { label: t('Open most recent conversation'), disabled: !items.length,
      onClick: () => { const recent = [...items].sort((a, b) => b.updatedAt - a.updatedAt)[0]; if (recent) open(recent.id); } },
    { label: t('Copy as Markdown'), group: 'clipboard', disabled: batchBusy, onClick: () => { void copyMarkdown(items); } },
    { label: t('Delete {{count}} matching conversations…', { count: deletable(items).length }), danger: true,
      disabled: batchBusy || !deletable(items).length, onClick: () => { void deleteMatching(items); } },
  ];
  const updateFilter = (patch: Partial<ConversationHistoryFilter>) => setFilter(current => updateConversationHistoryFilter(current, patch));
  const anchorFrom = (element: HTMLButtonElement, align: 'start' | 'end' = 'start') => {
    const rect = element.getBoundingClientRect();
    return { x: align === 'end' ? rect.right : rect.left, y: rect.bottom + 4, trigger: element };
  };
  const actionMenuAnchorFrom = (element: HTMLButtonElement) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.right - 180, y: rect.bottom + 4, trigger: element };
  };
  const closeSharedMenus = () => { setFilterMenu(null); setSortMenu(null); setGroupMenu(null); setActionsMenu(null); };
  const openRowMenu = (id: string, anchor: MenuAnchor) => {
    closeSharedMenus();
    setNotePrompt(null);
    setRowMenu(current => current?.id === id ? null : { id, anchor });
  };
  const rowMenuConversation = rowMenu ? conversations.find(item => item.id === rowMenu.id) ?? null : null;
  const notePromptConversation = notePrompt ? conversations.find(item => item.id === notePrompt.id) ?? null : null;
  const rowMenuItems: ContextMenuItem[] = [];
  if (rowMenu && rowMenuConversation) {
    rowMenuItems.push(
      { label: t('Open conversation'), onClick: () => open(rowMenuConversation.id) },
      { label: t('Copy as Markdown'), group: 'clipboard', disabled: batchBusy, onClick: () => { void copyMarkdown([rowMenuConversation]); } },
      { label: notes[noteKey(rowMenuConversation.id)] ? t('Edit note…') : t('Add note…'), group: 'edit',
        onClick: () => { setRowMenu(null); setNotePrompt({ id: rowMenuConversation.id, anchor: rowMenu.anchor }); } },
      { label: starredIds.has(rowMenuConversation.id) ? t('Unstar') : t('Star'), group: 'view',
        onClick: () => useHistoryMetaStore.getState().toggleStar(noteKey(rowMenuConversation.id)) },
      { label: t(lockedRecords[noteKey(rowMenuConversation.id)] ? 'Unlock record' : 'Lock record'), group: 'organize',
        onClick: () => meta.setLocked([noteKey(rowMenuConversation.id)], !lockedRecords[noteKey(rowMenuConversation.id)]) },
    );
    if (sendingId !== rowMenuConversation.id) {
      rowMenuItems.push({ label: t('Delete conversation'), danger: true, disabled: batchBusy || Boolean(lockedRecords[noteKey(rowMenuConversation.id)]), onClick: () => { void remove(rowMenuConversation.id); } });
    }
  }

  const filterSections: HistoryMenuSection[] = [
    {
      label: t('Type'),
      options: TYPE_VALUES.map(value => ({
        label: t(TYPE_LABELS[value]), active: filter.type === value, onSelect: () => updateFilter({ type: value }),
      })),
    },
    {
      label: t('Date field'),
      options: (['updated', 'created'] as const).map(value => ({
        label: t(value === 'created' ? 'Created date' : 'Updated date'), active: value === dateField,
        onSelect: () => updateFilter({ dateField: value }),
      })),
    },
    {
      label: t(dateField === 'created' ? 'Created date' : 'Updated date'),
      options: DATE_VALUES.map(value => ({
        label: t(DATE_LABELS[value]), active: filter.date === value, onSelect: () => updateFilter({ date: value }),
      })),
    },
    {
      label: t('Favorites'),
      options: [{
        label: t('Starred only'), active: filter.starredOnly,
        onSelect: () => updateFilter({ starredOnly: !filter.starredOnly }),
      }],
    },
  ];
  const sortSections: HistoryMenuSection[] = [{
    label: t(filter.groupBy === 'none' ? 'Sort records' : 'Sort within groups'),
    options: SORT_VALUES.map(value => ({
      label: t(SORT_LABELS[value]), active: filter.sort === value,
      onSelect: () => { updateFilter({ sort: value }); setSortMenu(null); },
    })),
  }];
  const groupSections: HistoryMenuSection[] = [{
    label: t('Group by'),
    options: CONVERSATION_GROUP_BY_OPTIONS.map(option => ({
      label: t(option.label), active: option.value === filter.groupBy,
      onSelect: () => { updateFilter({ groupBy: option.value }); setGroupMenu(null); },
    })),
  }];

  return <HistoryPage
    busy={batchBusy}
    pageTestId="ai-history-page"
    listLabel={t('AI conversation history')}
    icon={<History size={13} aria-hidden="true" />}
    title={t('AI conversation history')}
    count={`${t('{{count}} conversations', { count: visible.length })}${batchBusy ? ` · ${t('Working')}` : ''}`}
    query={filter.query}
    onQueryChange={query => updateFilter({ query })}
    searchLabel={t('Search conversations')}
    searchPlaceholder={t('Search conversations…')}
    searchTestId="ai-history-search"
    listClassName="ai-history-list"
    headerActions={<>
      <IconButton compact className="toolbar-icon-button history-icon-button" aria-label={t('Filter conversations')}
        aria-haspopup="menu" aria-expanded={filterMenu !== null}
        data-tip={t('Filter conversations')}
        data-active={hasConversationHistoryFilter(filter) ? 'true' : undefined}
        data-testid="ai-history-filter-btn"
        onClick={event => { closeSharedMenus(); setRowMenu(null); setNotePrompt(null); if (!filterMenu) setFilterMenu(anchorFrom(event.currentTarget)); }}>
        <Filter size={16} aria-hidden="true" />
      </IconButton>
      <IconButton compact className="toolbar-icon-button history-icon-button" aria-label={t('Sort conversations')}
        aria-haspopup="menu" aria-expanded={sortMenu !== null}
        data-tip={t('Sort conversations')}
        data-active={filter.sort !== 'updated-desc' ? 'true' : undefined}
        data-testid="ai-history-sort-btn"
        onClick={event => { closeSharedMenus(); setRowMenu(null); setNotePrompt(null); if (!sortMenu) setSortMenu(anchorFrom(event.currentTarget, 'end')); }}>
        <ArrowSort size={16} aria-hidden="true" />
      </IconButton>
      <IconButton compact className="toolbar-icon-button history-icon-button" aria-label={t('Group by')}
        aria-haspopup="menu" aria-expanded={groupMenu !== null}
        data-tip={t('Group by')}
        data-tip-description={t('Time groups use the selected date field. Other groups are ordered by name; sorting applies within each group.')}
        data-active={filter.groupBy !== 'day' ? 'true' : undefined} data-testid="ai-history-group-by"
        onClick={event => { closeSharedMenus(); setRowMenu(null); setNotePrompt(null); if (!groupMenu) setGroupMenu(anchorFrom(event.currentTarget, 'end')); }}>
        <Grid size={16} aria-hidden="true" />
      </IconButton>
    </>}
    searchActions={<IconButton compact className="toolbar-icon-button history-icon-button" aria-label={t('More actions')}
      aria-haspopup="menu" aria-expanded={actionsMenu !== null} data-tip={t('More actions')}
      data-testid="ai-history-actions-menu-button"
      onClick={event => { closeSharedMenus(); setRowMenu(null); setNotePrompt(null); if (!actionsMenu) setActionsMenu(actionMenuAnchorFrom(event.currentTarget)); }}>
      <Ellipsis size={16} aria-hidden="true" />
    </IconButton>}
    overlays={<>
      {actionsMenu && <ContextMenu anchor={actionsMenu} itemRole="menuitem"
        items={[
          { label: t('New conversation'), onClick: create },
          ...groupOperations.pageItems(historyGroups.map(group => group.id)),
          { label: t('Copy matching conversations as Markdown'), group: 'clipboard', disabled: batchBusy || !visible.length, onClick: () => { void copyMarkdown(visible); } },
        ]}
        onClose={() => setActionsMenu(null)} />}
      {rowMenu && rowMenuConversation && <ContextMenu anchor={rowMenu.anchor} items={rowMenuItems} itemRole="menuitem"
        onClose={() => setRowMenu(null)} />}
      {notePrompt && notePromptConversation && <HistoryTextPrompt anchor={notePrompt.anchor} label={t('Note')}
        placeholder={t('Write a note…')} value={notes[noteKey(notePromptConversation.id)] ?? ''} multiline saveLabel={t('Save')}
        testId={`conversation-note-${notePromptConversation.id}`}
        onSave={text => useHistoryMetaStore.getState().setNote(noteKey(notePromptConversation.id), text)}
        onClose={() => setNotePrompt(null)} />}
      {filterMenu && <HistoryOptionMenu anchor={filterMenu} testId="ai-history-filter-menu" sections={filterSections}
        onClose={() => setFilterMenu(null)} width={184} maxHeight={360} />}
      {sortMenu && <HistoryOptionMenu anchor={sortMenu} testId="ai-history-sort-menu" sections={sortSections}
        onClose={() => setSortMenu(null)} width={184} maxHeight={300} align="end" />}
      {groupMenu && <HistoryOptionMenu anchor={groupMenu} testId="ai-history-group-menu" sections={groupSections}
        onClose={() => setGroupMenu(null)} width={184} maxHeight={360} align="end" />}
    </>}
  >
    {error && !loaded && <ErrorBox compact actions={<button type="button" onClick={() => void useChatStore.getState().loadConversations()}>{t('Retry')}</button>}>
      {t('Could not load conversations')}: {error}
    </ErrorBox>}
    {loading && !conversations.length ? <div className="history-empty">{t('Loading conversations…')}</div>
      : visible.length ? historyGroups.map(group => <HistoryGroupCard key={group.id} id={group.id}
        {...groupOperations.forGroup(group.id, group.title, group.items.map(item => item.id))}
        timestamp={group.items.reduce((latest, item) => Math.max(latest, conversationHistoryTimestamp(item, filter.sort, dateField)), 0)}
        count={t('{{count}} conversations', { count: group.items.length })}
        actions={groupItems(group.items)}>
        {group.items.map(item => <SidebarItem key={item.id}
          icon={<span className="history-row-icon"><Sparkles size={16} aria-hidden="true" /></span>}
          title={item.title}
          subtitle={[
            item.environment?.label ?? t('Discussion only'),
            new Date(item.updatedAt).toLocaleDateString(),
            notes[noteKey(item.id)] ? t('Note: {{note}}', { note: notes[noteKey(item.id)] }) : null,
          ].filter(Boolean).join(' · ')}
          subtitleFontFamily="var(--font-ui)"
          variant="history"
          compact
          active={item.id === activeId} testId={`conversation-row-${item.id}`} tabIndex={0}
          tooltip={t('Open conversation')} onClick={() => open(item.id)}
          onContextMenu={event => {
            event.preventDefault(); event.stopPropagation();
            openRowMenu(item.id, { x: event.clientX, y: event.clientY, trigger: event.currentTarget });
          }}
          onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); open(item.id); } }}
          badge={starredIds.has(item.id) || sendingId === item.id || lockedRecords[noteKey(item.id)] ? <span className="history-row-flags">
            {lockedRecords[noteKey(item.id)] && <span className="history-row-lock" data-tip={t('Locked record')}><Lock size={16} aria-hidden="true" /></span>}
            {starredIds.has(item.id) && <span className="history-row-star" data-tip={t('Starred')} data-testid={`conversation-star-${item.id}`}><Star size={16} aria-hidden="true" /></span>}
            {sendingId === item.id && <span className="ai-history-working">{t('Working')}</span>}
          </span> : undefined}
          action={sendingId === item.id ? undefined : {
            icon: <Ellipsis size={16} aria-hidden="true" />,
            label: t('More actions'),
            title: t('More actions'),
            testId: `conversation-menu-${item.id}`,
            onClick: event => {
              const rect = event.currentTarget.getBoundingClientRect();
              openRowMenu(item.id, { x: rect.right - 180, y: rect.bottom + 4, trigger: event.currentTarget });
            },
          }} />)}
      </HistoryGroupCard>)
        : error && !loaded ? null
          : <div className="history-empty">{filter.query || hasConversationHistoryFilter(filter) ? t('No matching conversations') : t('No conversations yet')}</div>}
  </HistoryPage>;
}
