import { useEffect, useId, useRef, useState, type MouseEvent } from 'react';
import { t } from '@i18n';
import { useCommandHistorySettings } from '@config/commandHistory';
import type { GroupingProposal } from '@features/agent/services/autoGrouping';
import { useToolWindow } from '@ui/hooks/useToolWindow';
import type { HistoryCommandEntry } from '@core/commandHistory';
import { commandEnvironment } from '@core/commandHistory';
import { TextButton } from '@ui/TextButton';
import { IconBtn } from '@ui/UiBtn';
import SidebarToolbar from '@ui/SidebarToolbar';
import FilterChip from '@ui/FilterChip';
import { Ellipsis, Filter, Folder, iconSizes, Plus, Sparkles, Terminal } from '@ui/icons';
import ErrorBox from '@ui/ErrorBox';
import ContextMenu, { type MenuAnchor } from '@ui/ContextMenu';
import ConfirmDialog from '@ui/ConfirmDialog';
import HistoryOptionMenu from '@ui/HistoryOptionMenu';
import { safeLocalStorageGet, safeLocalStorageSet } from '@utils/errorHandler';
import { ListReorderPreview, useListReorder, useListReorderDrag } from '@ui/listReorder';
import { useProjectScope } from '../hooks/useProjectScope';
import { useCommandLibrary } from '../hooks/useCommandLibrary';
import { readCommandCollapse, writeCommandCollapse } from '../model/collapse';
import { commandKey, projectItems, type CommandItem, type CommandSort } from '../model/commands';
import { fillHistoryCommand, hasCommandDraft, runHistoryCommand, type ExecutionContext } from '../services/execution';
import { copyCommand, importLegacyCommands, openCommandSettings, openCommandModelSettings } from '../services/libraryActions';
import HistoryCommandRow from './HistoryCommandRow';
import CommandEditor from './CommandEditor';
import ProjectRootMenu from './ProjectRootMenu';
import CommandRulesDialog from './CommandRulesDialog';
import CommandDetails from './CommandDetails';
import CommandGroupSection from './CommandGroupSection';
import { applyCommandGrouping, commandGroups, commandGroupOrder, dropCommand, moveCommandToGroup, prependCommandGroup, reorderCommandGroups } from '../model/groups';
import './commandHistory.css';

const SORT_KEY = 'command-history-sort';

export default function PanelCommandHistory() {
  const scope = useProjectScope();
  const [rootMenu, setRootMenu] = useState(false);
  const chooseRoot = () => setRootMenu(true);
  useEffect(() => {
    setRootMenu(false);
  }, [scope.cwd, scope.kind, scope.visible]);
  return <div className="command-history-panel" data-testid="command-history-panel">
    {!scope.context && <SidebarToolbar search={{ 'aria-label': t('Search command history'), placeholder: t('Search command history…'), disabled: true }}>
      <IconBtn title={t('Set project root')} disabled={!scope.available} onClick={chooseRoot}><Folder size={iconSizes.control} /></IconBtn>
    </SidebarToolbar>}
    {scope.error && <ErrorBox title={t('Could not open command history')} details={scope.error} actions={<TextButton onClick={scope.retry}>{t('Retry')}</TextButton>} />}
    {!scope.available && <div className="history-empty"><Terminal size={22} aria-hidden="true" /><span>{t('Open a terminal in a project to browse its commands.')}</span></div>}
    {scope.available && !scope.context && !scope.error && <div className="history-empty" role="status">{t('Finding project…')}</div>}
    {scope.context && <CommandLibrary key={scope.context.scope} context={scope.context} visible={scope.visible} onChooseRoot={chooseRoot} />}
    {scope.visible && rootMenu && <ProjectRootMenu initial={scope.context?.root ?? scope.cwd} local={scope.kind === 'local'}
      onSave={scope.chooseRoot} onClose={() => setRootMenu(false)} />}
  </div>;
}

function anchorFor(event: MouseEvent): MenuAnchor {
  const trigger = event.currentTarget as HTMLElement;
  const rect = trigger.getBoundingClientRect();
  return { x: rect.left, y: rect.bottom + 6, trigger };
}

function commandRows(element: HTMLElement | null) {
  return [...element?.querySelectorAll<HTMLElement>('[data-command-history]') ?? []].filter(row => !row.closest('[hidden]'));
}

function CommandLibrary({ context, visible, onChooseRoot }: {
  context: ExecutionContext; visible: boolean; onChooseRoot: (event: MouseEvent) => void;
}) {
  const library = useCommandLibrary(context, visible);
  const { preferences, update } = library;
  const { runIn, doubleClick } = useCommandHistorySettings();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [directory, setDirectory] = useState('project');
  const [organizedOnly, setOrganizedOnly] = useState(false);
  const [sort, setSort] = useState<CommandSort>(() => { const saved = safeLocalStorageGet(SORT_KEY); return saved === 'frequent' || saved === 'manual' ? saved : 'recent'; });
  const [expanded, setExpanded] = useState<string | null>(null);
  const detailsId = useId();
  /** Section and group ids that stay folded; the saved layout survives restarts. */
  const [collapsed, setCollapsed] = useState<Set<string>>(readCommandCollapse);
  /** Ids a running search reveals; clearing the query returns to the saved layout. */
  const [searchRevealed, setSearchRevealed] = useState<Set<string>>(() => new Set());
  const [renamingGroup, setRenamingGroup] = useState<{ id: string; name: string } | null>(null);
  const [removingGroup, setRemovingGroup] = useState<string | null>(null);
  const [filterMenu, setFilterMenu] = useState<MenuAnchor | null>(null);
  const [actionsMenu, setActionsMenu] = useState<MenuAnchor | null>(null);
  const [rulesMenu, setRulesMenu] = useState<{ initialRule?: string } | null>(null);
  const [error, setError] = useState('');
  const [menu, setMenu] = useState<{ item: CommandItem; anchor: MenuAnchor } | null>(null);
  const [editor, setEditor] = useState<{ item: CommandItem | null; groupId?: string; focus?: 'name' } | null>(null);
  const [removing, setRemoving] = useState<CommandItem | null>(null);
  const mutation = useRef(false);
  const [replace, setReplace] = useState<{ item: CommandItem; context: ExecutionContext } | null>(null);
  const [legacy, setLegacy] = useState<HistoryCommandEntry[] | null>(null);
  const [running, setRunning] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = `command-history:${context.scope}`;
  const draggingCommand = useListReorder(state => state.drag?.listId === listId && state.drag.kind === 'command-history');
  useEffect(() => { if (!visible) { setRulesMenu(null); setFilterMenu(null); setActionsMenu(null); setMenu(null); setRenamingGroup(null); } }, [visible]);
  const isFolded = (id: string) => collapsed.has(id) && !searchRevealed.has(id);
  /** Folding follows what the panel currently shows and stores the resulting layout for later launches. */
  const toggleFold = (id: string, folded: boolean) => {
    const next = new Set(collapsed);
    if (folded) next.delete(id); else next.add(id);
    setCollapsed(next);
    writeCommandCollapse(next);
    if (searchRevealed.has(id)) { const shown = new Set(searchRevealed); shown.delete(id); setSearchRevealed(shown); }
  };
  /** A running search reveals every section so matches stay reachable without changing the saved layout. */
  const changeQuery = (value: string) => {
    setQuery(value);
    if (!value.trim()) { if (searchRevealed.size) setSearchRevealed(new Set()); return; }
    if (!query.trim()) setSearchRevealed(new Set(collapsed));
  };
  /** Page actions replace the whole saved layout. */
  const foldAll = (folded: boolean) => {
    const next = folded ? new Set(['favorites', 'history', ...preferences.groups?.map(group => group.id) ?? []]) : new Set<string>();
    setCollapsed(next);
    writeCommandCollapse(next);
    if (searchRevealed.size) setSearchRevealed(new Set());
  };
  const result = projectItems(library.ready ? library.history : [], preferences, query, status, directory === 'current' ? context.cwd : undefined, sort, organizedOnly);
  const allItems = projectItems(library.history, preferences, '', 'all');
  const groupable = [...allItems.favorites, ...allItems.history];
  const grouped = commandGroups(result.favorites, result.history, preferences);
  const sections = [
    { id: 'favorites', title: t('Favorites'), items: grouped.favorites, collapsed: isFolded('favorites'), custom: false },
    ...grouped.groups.map(group => ({ ...group, title: group.name, collapsed: isFolded(group.id), custom: true })),
    { id: 'history', title: t('Ungrouped commands'), items: grouped.history, collapsed: isFolded('history'), custom: false },
  ].sort((a, b) => commandGroupOrder(preferences).indexOf(a.id) - commandGroupOrder(preferences).indexOf(b.id))
    .filter(group => draggingCommand || group.items.length > 0 || group.custom && !organizedOnly && !query.trim() && status === 'all' && directory === 'project'
    || group.id === 'history' && !organizedOnly && (status !== 'all' || directory !== 'project'));
  const selected = sections.filter(group => !group.collapsed).flatMap(group => group.items).find(item => item.id === expanded);
  const favoriteIds = new Set(preferences.favorites.map(item => item.id));
  const closeDetails = () => {
    commandRows(listRef.current).find(row => row.dataset.commandHistory === expanded)?.focus();
    setExpanded(null);
  };
  const changeSort = (value: CommandSort) => { setSort(value); safeLocalStorageSet(SORT_KEY, value); };
  const sortOptions = { label: t('Sort commands'), group: 'view' as const, submenu: { items:
    [{ value: 'recent' as const, label: t('Recent commands') }, { value: 'frequent' as const, label: t('Most used commands') }, { value: 'manual' as const, label: t('Custom order') }]
      .map(option => ({ label: option.label, checked: sort === option.value, onClick: () => changeSort(option.value) })) } };
  const filtered = status !== 'all' || directory !== 'project' || organizedOnly;
  const statusLabel = t(status === 'success' ? 'Succeeded' : 'Failed');
  const environment = `${context.spec.kind === 'ssh' ? context.spec.ssh?.name || context.spec.ssh?.host || 'SSH' : t('Local')} · ${commandEnvironment(context.spec).shell}`;
  const filters = [
    ...(status !== 'all' ? [{ id: 'status', label: statusLabel, remove: () => setStatus('all') }] : []),
    ...(organizedOnly ? [{ id: 'collection', label: t('Starred or grouped commands'), remove: () => setOrganizedOnly(false) }] : []),
    ...(directory === 'current' ? [{ id: 'directory', label: t('Current directory'), remove: () => setDirectory('project') }] : []),
  ];
  const resetFilters = () => { changeQuery(''); setStatus('all'); setDirectory('project'); setOrganizedOnly(false); };
  const favorite = (item: CommandItem) => update(value => value.favorites.some(entry => commandKey(entry) === commandKey(item)) ? value : {
    ...value, favorites: [...value.favorites, { id: crypto.randomUUID(), name: item.name, command: item.command, cwd: item.cwd, shell: item.shell }],
  });
  /** New groups start with a unique default name and open their inline rename right away. */
  const createGroup = (item?: CommandItem) => {
    const base = t('New group');
    const names = new Set(preferences.groups?.map(group => group.name) ?? []);
    let name = base;
    for (let suffix = 2; names.has(name); suffix += 1) name = `${base} ${suffix}`;
    const id = crypto.randomUUID();
    changeQuery(''); setStatus('all'); setDirectory('project'); setOrganizedOnly(false);
    update(value => prependCommandGroup(value, { id, name, commandKeys: item ? [commandKey(item)] : [] }));
    setRenamingGroup({ id, name });
  };
  const commitGroupRename = () => {
    if (!renamingGroup) return;
    const name = renamingGroup.name.trim();
    if (name && name !== preferences.groups?.find(group => group.id === renamingGroup.id)?.name) {
      update(value => ({ ...value, groups: value.groups?.map(group => group.id === renamingGroup.id ? { ...group, name } : group) }));
    }
    setRenamingGroup(null);
  };
  const fill = (item: CommandItem) => {
    if (hasCommandDraft(context.paneId)) { setReplace({ item, context }); return; }
    try { fillHistoryCommand(context, item); } catch (reason) { setError(String(reason)); }
  };
  const run = (item: CommandItem) => {
    if (running) return;
    setRunning(true); setError('');
    void runHistoryCommand(context, item, runIn).catch(reason => setError(String(reason))).finally(() => setRunning(false));
  };
  const openComposer = useToolWindow({ key: `command:${context.scope}:${context.paneId}`, kind: 'command', title: t('Write with AI'),
    input: { context, recent: groupable.map(item => item.command) }, onError: reason => setError(String(reason)),
    onAction: async (action: { type: 'fill' | 'favorite'; item: CommandItem } | { type: 'settings' }) => {
      if (action.type === 'settings') { openCommandModelSettings(); return; }
      if (action.type === 'fill') { fill(action.item); return; }
      const item = action.item;
      await library.persistPreferences(value => value.favorites.some(entry => commandKey(entry) === commandKey(item)) ? value : {
        ...value, favorites: [...value.favorites, { id: crypto.randomUUID(), name: item.name, command: item.command, cwd: item.cwd, shell: item.shell }],
      });
    } });
  const openGrouping = useToolWindow({ key: `grouping:${context.scope}`, kind: 'grouping', title: t('AI auto-group'),
    input: { kind: 'command history', items: groupable.map(item => ({ id: item.id, label: item.name, detail: `${item.command}\n${item.cwd} · ${item.shell}` })) },
    onError: reason => setError(String(reason)), onAction: async (action: { type: 'apply'; groups: GroupingProposal[] }) => {
      const keys = new Map(groupable.map(item => [item.id, commandKey(item)]));
      if (action.groups.some(group => group.itemIds.some(id => !keys.has(id)))) throw new Error(t('Items changed. Generate a new grouping plan.'));
      await library.persistPreferences(value => applyCommandGrouping(value, action.groups, keys));
    } });
  const drag = useListReorderDrag({ listId, onDrop: (source, target) => {
    if (!target || source.id === target.itemId) return;
    if (source.kind === 'command-history-group') {
      if (target.itemId) update(value => reorderCommandGroups(value, source.id, target.itemId!, target.after));
      return;
    }
    const all = projectItems(library.history, preferences, '', 'all', undefined, sort);
    const allGroups = commandGroups(all.favorites, all.history, preferences);
    const entries = [...all.favorites, ...all.history];
    const item = entries.find(entry => entry.id === source.id);
    const destination = target.zoneId ?? [
      { id: 'favorites', items: allGroups.favorites }, ...allGroups.groups, { id: 'history', items: allGroups.history },
    ].find(group => group.items.some(entry => entry.id === target.itemId))?.id;
    if (!item || !destination) return;
    const targetItem = entries.find(entry => entry.id === target.itemId);
    const applyDrop = () => {
      update(value => dropCommand(value, item, destination, targetItem ? commandKey(targetItem) : undefined, target.after, allGroups.history.map(commandKey)));
      if (destination === 'history') changeSort('manual');
    };
    if (destination === 'history' && !library.history.some(entry => commandKey(entry) === commandKey(item))) {
      void library.saveCommand(item, { name: item.name, command: item.command, cwd: item.cwd, shell: item.shell })
        .then(applyDrop).catch(reason => setError(String(reason)));
    } else applyDrop();
  } });
  const openMenu = (event: MouseEvent<HTMLElement>, item: CommandItem) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setMenu({ item, anchor: { x: event.type === 'contextmenu' ? event.clientX : rect.left, y: event.type === 'contextmenu' ? event.clientY : rect.bottom, trigger: event.currentTarget } });
  };
  return <>
    <SidebarToolbar search={{ 'aria-label': t('Search command history'), placeholder: t('Search command history…'), value: query,
      disabled: !library.ready, onChange: event => changeQuery(event.target.value),
      onKeyDown: event => { if (event.key === 'ArrowDown' && !event.nativeEvent.isComposing) { event.preventDefault(); commandRows(listRef.current)[0]?.focus(); } } }}>
      <IconBtn title={t('Write with AI')} disabled={!library.ready} aria-haspopup="dialog" onClick={openComposer}><Sparkles size={iconSizes.control} /></IconBtn>
      <IconBtn title={t('New command')} disabled={!library.ready} onClick={() => setEditor({ item: null })}><Plus size={iconSizes.control} /></IconBtn>
    </SidebarToolbar>
    <div className="command-history-context">
      <TextButton className="command-history-root" aria-label={t('Set project root')} aria-haspopup="dialog" data-tip={context.root}
        data-tip-description={environment} onClick={onChooseRoot}>
        <Folder size={iconSizes.compact} aria-hidden="true" />
        <span>{context.root}</span>
      </TextButton>
      <IconBtn title={t('Filter commands')} className="toolbar-icon-button" data-active={filtered} data-testid="command-history-filter"
        disabled={!library.ready} aria-haspopup="menu" aria-expanded={!!filterMenu}
        onClick={event => { const anchor = anchorFor(event); setFilterMenu(value => value ? null : anchor); }}><Filter size={iconSizes.compact} /></IconBtn>
      <IconBtn title={t('Command history actions')} data-testid="command-history-more" disabled={!library.ready} aria-haspopup="menu" aria-expanded={!!actionsMenu}
        onClick={event => { const anchor = anchorFor(event); setActionsMenu(value => value ? null : anchor); }}><Ellipsis size={iconSizes.compact} /></IconBtn>
    </div>
    {filters.length > 0 && <div className="command-history-filter-chips" data-testid="command-history-filter-chips" aria-label={t('Active filters')}>
      {filters.map(filter => <FilterChip key={filter.id} testId={`command-history-filter-${filter.id}`}
        removeLabel={t('Remove filter: {{filter}}', { filter: filter.label })} onRemove={filter.remove}>{filter.label}</FilterChip>)}
    </div>}
    {library.error && <ErrorBox title={t('Could not load or save command history')} details={library.error} actions={<TextButton onClick={library.retry}>{t('Retry')}</TextButton>} />}
    {error && <ErrorBox title={t('Command action failed')} actions={<TextButton onClick={() => setError('')}>{t('Dismiss')}</TextButton>}>{error}</ErrorBox>}
    {visible && filterMenu && <HistoryOptionMenu anchor={filterMenu} testId="command-history-filter-menu" width={184} sections={[
      { label: t('Command status'), options: [{ value: 'all', label: t('All statuses') }, { value: 'success', label: t('Succeeded') }, { value: 'failed', label: t('Failed') }]
        .map(option => ({ label: option.label, active: status === option.value, onSelect: () => setStatus(option.value) })) },
      { label: t('Command collection'), options: [{ label: t('All commands'), active: !organizedOnly, onSelect: () => setOrganizedOnly(false) },
        { label: t('Starred or grouped commands'), active: organizedOnly, onSelect: () => setOrganizedOnly(true) }] },
      { label: t('Command scope'), options: [{ value: 'project', label: t('Entire project') }, { value: 'current', label: t('Current directory') }]
        .map(option => ({ label: option.label, active: directory === option.value, onSelect: () => setDirectory(option.value) })) },
    ]} onClose={() => setFilterMenu(null)} />}
    {visible && actionsMenu && <ContextMenu anchor={actionsMenu} label={t('Command history actions')} onClose={() => setActionsMenu(null)} items={[
      { label: t('New command group'), onClick: () => createGroup() },
      { label: t('AI auto-group'), disabled: !groupable.length, onClick: openGrouping },
      { label: t('Refresh'), group: 'view', onClick: library.refresh },
      sortOptions,
      { label: t('Expand all command groups'), group: 'view', onClick: () => foldAll(false) },
      { label: t('Collapse all command groups'), group: 'view', onClick: () => foldAll(true) },
      { label: t('Import older commands'), onClick: () => { void importLegacyCommands(context).then(setLegacy).catch(reason => setError(String(reason))); } },
      { label: t('Command history settings'), group: 'view', onClick: openCommandSettings },
      { label: t('Hidden commands and exclusion rules'), group: 'organize', onClick: () => setRulesMenu({}) },
    ]} />}
    <div className="command-history-body scroll-region" onScroll={() => { if (menu) setMenu(null); }} onContextMenu={event => {
      // Blank areas only: rows, group headings and portaled overlays keep their own menus.
      const target = event.target instanceof Element ? event.target : null;
      if (!target || target.closest('[data-command-history], .command-history-section, [role="dialog"], [role="menu"], [role="listbox"]')) return;
      event.preventDefault();
      setActionsMenu({ x: event.clientX, y: event.clientY, trigger: event.currentTarget });
    }}>
      {visible && rulesMenu && <CommandRulesDialog initialRule={rulesMenu.initialRule} preferences={preferences}
        onChange={library.persistPreferences} onClose={() => setRulesMenu(null)} />}
      {legacy && <section className="command-history-management" aria-label={t('Import older commands')}>
        <h3>{t('Import older commands')}</h3><p>{t('Older history has no reliable environment. Import selected commands into this project and current shell.')}</p>
        {legacy.map(item => <div className="command-history-rule" key={item.id}><span>{item.command}</span><TextButton onClick={() => {
          favorite({ ...item, name: item.command, shell: commandEnvironment(context.spec).shell }); setLegacy(items => items?.filter(entry => entry.id !== item.id) ?? null);
        }}>{t('Import')}</TextButton></div>)}
        <TextButton onClick={() => setLegacy(null)}>{t('Close')}</TextButton>
      </section>}
      <div ref={listRef} data-reorder-list={listId} onKeyDown={event => {
        if ((event.key !== 'ArrowDown' && event.key !== 'ArrowUp') || event.nativeEvent.isComposing) return;
        const rows = commandRows(event.currentTarget);
        const index = rows.indexOf(document.activeElement as HTMLElement);
        if (index >= 0) {
          event.preventDefault();
          const next = rows[Math.max(0, Math.min(rows.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))];
          next?.focus();
          if (next && expanded) setExpanded(next.dataset.commandHistory ?? null);
        }
      }}>
        {sections.map(group => <CommandGroupSection key={group.id} id={group.id} title={group.title} count={group.items.length} visible={visible} listId={listId}
          onDrag={group.id === 'history' ? undefined : event => drag(event, { id: group.id, kind: 'command-history-group' })}
          actions={[
            { label: t('AI auto-group'), disabled: !groupable.length, onClick: openGrouping },
            ...(group.id === 'history' ? [sortOptions] : []),
            ...(group.custom ? [
            { label: t('New command'), onClick: () => setEditor({ item: null, groupId: group.id }) },
            { label: t('Remove commands from group'), group: 'organize' as const, disabled: !preferences.groups?.find(entry => entry.id === group.id)?.commandKeys.length,
              onClick: () => update(value => ({ ...value, groups: value.groups?.map(entry => entry.id === group.id ? { ...entry, commandKeys: [] } : entry) })) },
          ] : [])]}
          color={preferences.groupColors?.[group.id]} collapsed={group.collapsed}
          onToggle={() => toggleFold(group.id, group.collapsed)}
          toggleLabel={group.id === 'favorites' ? t(group.collapsed ? 'Expand favorites' : 'Collapse favorites') : undefined}
          onColor={group.id === 'history' ? undefined : color => update(value => { const groupColors = { ...value.groupColors }; if (color) groupColors[group.id] = color; else delete groupColors[group.id]; return { ...value, groupColors }; })}
          onRename={group.custom ? () => setRenamingGroup({ id: group.id, name: group.title }) : undefined}
          renaming={renamingGroup !== null && renamingGroup.id === group.id}
          renameValue={renamingGroup !== null && renamingGroup.id === group.id ? renamingGroup.name : ''}
          onRenameChange={value => setRenamingGroup(current => current ? { ...current, name: value } : current)}
          onRenameCommit={commitGroupRename} onRenameCancel={() => setRenamingGroup(null)}
          onDelete={group.custom ? () => setRemovingGroup(group.id) : undefined}>
            {group.items.map(item => <HistoryCommandRow key={item.id} item={item} active={menu?.item.id === item.id || expanded === item.id}
              selected={selected?.id === item.id} detailsId={detailsId} showCount={!favoriteIds.has(item.id) && sort === 'frequent'} listId={listId}
              onSelect={() => setExpanded(item.id)} onCloseDetails={closeDetails}
              onFill={() => fill(item)} onDoubleClick={() => doubleClick === 'run' ? run(item) : fill(item)} onMenu={event => openMenu(event, item)} onDrag={event => drag(event, { id: item.id, kind: 'command-history' })} />)}
            {group.items.length === 0 && (group.custom || draggingCommand) && <p className="command-history-group-empty">{t('Drag commands here')}</p>}
        </CommandGroupSection>)}
      </div>
      {!library.ready && !library.error && <div className="history-empty" role="status">{t('Loading commands…')}</div>}
      {library.ready && !library.error && !result.favorites.length && !result.history.length && <div className="history-empty">
        <Terminal size={22} aria-hidden="true" /><span>{t(query.trim() || filtered ? 'No matching commands' : 'No commands yet')}</span>
        {query.trim() || filtered ? <TextButton onClick={resetFilters}>{t('Clear filters')}</TextButton>
          : <span>{t('Run a command in this project or add one with +.')}</span>}
      </div>}
    </div>
    {selected ? <CommandDetails id={detailsId} item={selected} running={running}
      runLabel={t('Run in {{terminal}}', { terminal: t(runIn === 'new' ? 'New terminal' : 'Current terminal') })}
      onFill={() => fill(selected)} onRun={() => run(selected)} onClose={closeDetails} />
      : library.ready && (result.favorites.length > 0 || result.history.length > 0) && <div className="command-history-hint">{t(doubleClick === 'run' ? 'Double-click to run; press Enter to insert' : 'Double-click or press Enter to insert')}</div>}
    <ListReorderPreview listId={listId}>{source => source.kind === 'command-history-group' ? <Folder size={18} /> : <Terminal size={18} />}</ListReorderPreview>
    {menu && <ContextMenu anchor={menu.anchor} label={t('Command actions')} onClose={() => setMenu(null)} items={[
      { label: t('Show command details'), onClick: () => setExpanded(menu.item.id) },
      { label: t('Fill terminal input'), shortcut: 'Enter', onClick: () => fill(menu.item) },
      { label: t('Run command'), disabled: running, onClick: () => run(menu.item) },
      { label: t('Copy command'), group: 'clipboard', onClick: () => { void copyCommand(menu.item.command).catch(reason => setError(String(reason))); } },
      { label: t('Rename command'), group: 'edit', onClick: () => setEditor({ item: menu.item, focus: 'name' }) },
      { label: t('Edit command'), group: 'edit', onClick: () => setEditor({ item: menu.item }) },
      { label: t('AI auto-group'), group: 'organize', onClick: openGrouping },
      ...(!preferences.groups?.some(group => group.commandKeys.includes(commandKey(menu.item))) ? [
        { label: t('New command group'), group: 'organize' as const, onClick: () => createGroup(menu.item) },
      ] : []),
      ...(preferences.favorites.some(item => item.id === menu.item.id) ? [
        { label: t('Remove favorite'), group: 'organize' as const, onClick: () => update(value => ({ ...value, favorites: value.favorites.filter(item => item.id !== menu.item.id) })) },
      ] : [
        { label: t('Save as favorite'), group: 'organize' as const, onClick: () => favorite(menu.item) },
        { label: t('Hide this command'), group: 'organize' as const, onClick: () => update(value => ({ ...value, hidden: [...new Set([...value.hidden, commandKey(menu.item)])] })) },
        { label: t('Exclude similar commands'), group: 'organize' as const, onClick: () => setRulesMenu({ initialRule: menu.item.command.trimStart().split(/\s+/)[0] ?? '' }) },
      ]),
      { label: t('Delete command'), danger: true, onClick: () => setRemoving(menu.item) },
    ]} />}
    <ConfirmDialog open={!!removingGroup} title={t('Delete command group?')} message={t('Commands in this group will remain in the project.')}
      confirmLabel={t('Delete')} cancelLabel={t('Cancel')} onCancel={() => setRemovingGroup(null)} onConfirm={() => {
        update(value => { const groupColors = { ...value.groupColors }; if (removingGroup) delete groupColors[removingGroup];
          return { ...value, groups: value.groups?.filter(group => group.id !== removingGroup), groupColors }; });
        setRemovingGroup(null);
      }} />
    {editor && <CommandEditor initial={editor.item ? { name: editor.item.name === editor.item.command ? '' : editor.item.name,
      command: editor.item.command, cwd: editor.item.cwd, shell: editor.item.shell } : { name: '', command: '', cwd: context.cwd, shell: commandEnvironment(context.spec).shell }}
      initialFocus={editor.focus === 'name' ? '[data-command-editor-name]' : undefined}
      creating={!editor.item} root={context.root} onClose={() => setEditor(null)} onSave={async draft => {
        await library.saveCommand(editor.item, draft); changeQuery(''); setStatus('all'); setDirectory('project');
        if (editor.groupId) update(value => moveCommandToGroup(value, commandKey(draft), editor.groupId!));
      }} />}
    <ConfirmDialog open={!!removing} title={t('Delete command?')} message={t('Delete “{{name}}” from command history and favorites? This cannot be undone.', { name: removing?.name ?? '' })}
      danger confirmLabel={t('Delete')} cancelLabel={t('Cancel')} onCancel={() => { if (!mutation.current) setRemoving(null); }} onConfirm={() => {
        if (!removing || mutation.current) return;
        mutation.current = true;
        void library.deleteCommand(removing).then(() => setRemoving(null)).catch(reason => { setRemoving(null); setError(String(reason)); }).finally(() => { mutation.current = false; });
      }} />
    <ConfirmDialog open={!!replace} title={t('Replace terminal draft?')} message={t('The terminal already contains a draft. Replace it with this command?')}
      confirmLabel={t('Replace')} cancelLabel={t('Cancel')} onCancel={() => setReplace(null)} onConfirm={() => {
        if (replace) { try { fillHistoryCommand(replace.context, replace.item); } catch (reason) { setError(String(reason)); } }
        setReplace(null);
      }} />
  </>;
}
