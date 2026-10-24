import { Fragment, useEffect } from 'react';
import { t } from '@i18n';
import SidebarItem from '@ui/layout/sidebarItem';
import { IconButton } from '@ui/actions/IconButton';
import ResizeHandle from '@ui/layout/ResizeHandle';
import { ListReorderPlaceholder, ListReorderPreview, useListReorderDrag } from '@ui/layout/listReorder';
import { TerminalPrompt, FileCode, ServerStack, Settings, PanelLeft, History, iconSizes } from '@ui/icons';
import AiSessionIcon from '@features/chat/components/AiSessionIcon';
import { useUiStore } from '@features/workspace';
import { useWorkspaceNavigation, WORKSPACE_AREA_LABELS, WORKSPACE_COMPACT_BREAKPOINT, type WorkspaceArea } from '../stores/navigation';
import { selectWorkspaceArea } from '../services/selectWorkspaceArea';
import NavigationDragPreview from './NavigationDragPreview';
import SidePanel from './SidePanel';
import { isMacOS } from '@platform/runtime';

/** Functional navigation disappears completely when collapsed. */
export default function WorkspaceSidebar({ maxWidth = 400 }: { maxWidth?: number }) {
  const area = useWorkspaceNavigation(state => state.area);
  const collapsed = useWorkspaceNavigation(state => state.collapsed);
  const overlay = useWorkspaceNavigation(state => state.sidebarOverlay);
  const sidebarWidth = useWorkspaceNavigation(state => state.sidebarDragWidth ?? state.sidebarWidth);
  const settingsOpen = useUiStore(state => state.settingsOpen);
  const workspaceOrder = useWorkspaceNavigation(state => state.workspaceOrder);
  const historyLoading = useWorkspaceNavigation(state => state.historyLoading);
  useEffect(() => {
    let narrow = window.innerWidth <= WORKSPACE_COMPACT_BREAKPOINT;
    const resize = () => {
      const next = window.innerWidth <= WORKSPACE_COMPACT_BREAKPOINT;
      if (next && !narrow) useWorkspaceNavigation.getState().setCollapsed(true);
      narrow = next;
    };
    window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize);
  }, []);
  const items = [
    { id: 'terminal' as const, label: t(WORKSPACE_AREA_LABELS.terminal), Icon: TerminalPrompt },
    { id: 'code' as const, label: t(WORKSPACE_AREA_LABELS.code), Icon: FileCode },
    { id: 'ai' as const, label: t(WORKSPACE_AREA_LABELS.ai), Icon: AiSessionIcon },
    { id: 'ssh' as const, label: t(WORKSPACE_AREA_LABELS.ssh), Icon: ServerStack },
  ];
  const orderedItems = workspaceOrder.flatMap(id => {
    const item = items.find(candidate => candidate.id === id);
    return item ? [item] : [];
  });
  const itemById = new Map<string, (typeof items)[number]>(items.map(item => [item.id, item]));
  const startWorkspaceDrag = useListReorderDrag({
    listId: 'workspace-areas',
    edgeDrop: true,
    onDrop: (drag, target) => {
      if (!target?.itemId) return;
      useWorkspaceNavigation.getState().moveWorkspaceArea(drag.id as WorkspaceArea, target.itemId as WorkspaceArea, !!target.after);
    },
    accepts: () => true,
  });
  return <><aside className="workspace-sidebar" data-collapsed={collapsed} data-overlay={overlay || undefined} data-testid="workspace-sidebar" inert={collapsed} aria-hidden={collapsed || undefined}>
    <div className="workspace-sidebar-heading" data-tauri-drag-region>
      <span data-tauri-drag-region>{t('Workspaces')}</span>
      <div className="workspace-sidebar-header-actions">
        <IconButton compact data-testid="workspace-history" aria-label={t('All history')} data-tip={t('All history')}
          data-busy={historyLoading || undefined} onClick={() => selectWorkspaceArea('history')}>
          <History size={iconSizes.control} className={historyLoading ? 'reload-spin' : undefined} />
        </IconButton>
        <IconButton compact className="workspace-sidebar-toggle" data-testid="workspace-sidebar-toggle" aria-label={t('Collapse sidebar')} data-tip={t('Collapse sidebar')}
          onClick={() => useWorkspaceNavigation.getState().setCollapsed(true)}><PanelLeft size={iconSizes.control} /></IconButton>
      </div>
    </div>
    <nav aria-label={t('Workspaces')} className="workspace-area-navigation" data-reorder-list="workspace-areas">
      {orderedItems.map(({ id, label, Icon }, index) => <Fragment key={id}>
        <ListReorderPlaceholder listId="workspace-areas" itemId={id} />
        <SidebarItem compact title={label} icon={<Icon size={iconSizes.row} />} active={!settingsOpen && (area === id || id === 'ssh' && area === 'forwarding')}
          testId={`workspace-area-${id}`} dataAttributes={{ role: 'button', 'aria-label': label, 'data-dock-btn': id === 'terminal' ? 'tabs' : id === 'ssh' ? 'ssh' : undefined, 'aria-current': !settingsOpen && (area === id || id === 'ssh' && area === 'forwarding') ? 'page' : undefined }}
          tabIndex={0} reorderItemId={id} reorderListId="workspace-areas" reorderKind="workspace"
          onPointerDown={event => startWorkspaceDrag(event, { id, kind: 'workspace' })}
          onClick={() => selectWorkspaceArea(id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectWorkspaceArea(id); } }} />
        {index === orderedItems.length - 1 && <ListReorderPlaceholder listId="workspace-areas" itemId={id} after />}
      </Fragment>)}
    </nav>
    <div className="workspace-sidebar-tools" data-testid="workspace-left-dock">
      <SidePanel side="left" />
    </div>
    <div className="workspace-sidebar-footer">
      <SidebarItem compact title={t('Settings')} tooltip={t('Open settings')} icon={<Settings size={iconSizes.row} />} active={settingsOpen} dataAttributes={{ 'data-dock-btn': 'settings', 'data-dock-fixed': 'true', role: 'button', 'aria-label': t('Settings'), 'aria-pressed': String(settingsOpen), 'data-tip-shortcut': `${isMacOS ? 'Meta' : 'Control'}+,` }} testId="workspace-settings" tabIndex={0}
        onClick={() => useUiStore.getState().setSettingsOpen(!settingsOpen)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); useUiStore.getState().setSettingsOpen(!settingsOpen); } }} />
    </div>
    <NavigationDragPreview />
      <ListReorderPreview listId="workspace-areas" variant="icon">
        {drag => {
          const item = itemById.get(drag.id);
          if (!item) return null;
          const Icon = item.Icon;
          return <Icon size={iconSizes.row} />;
        }}
      </ListReorderPreview>
  </aside>
    <div className="workspace-sidebar-resize" hidden={collapsed}>
      <ResizeHandle axis="x" edge="right" label={t('Resize workspace sidebar')} testId="workspace-sidebar-resize"
        valueNow={Math.min(sidebarWidth, maxWidth)} valueMin={160} valueMax={maxWidth}
        onDelta={delta => useWorkspaceNavigation.getState().resizeSidebar(delta, maxWidth)}
        onUp={() => useWorkspaceNavigation.getState().commitSidebarWidth()}
        onReset={() => useWorkspaceNavigation.getState().resetSidebarWidth()} />
    </div>
  </>;
}
