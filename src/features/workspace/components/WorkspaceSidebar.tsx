import { useEffect } from 'react';
import { t } from '@i18n';
import SidebarItem from '@ui/sidebarItem';
import { IconButton } from '@ui/IconButton';
import { TerminalPrompt, FileCode, Sparkles, Server, Settings, PanelLeft, History, iconSizes } from '@ui/icons';
import { useSessionStore, useUiStore } from '@features/workspace';
import { useWorkspaceNavigation, WORKSPACE_COMPACT_BREAKPOINT } from '../stores/navigation';
import { selectWorkspaceArea } from '../services/selectWorkspaceArea';
import NavigationDragPreview from './NavigationDragPreview';
import { isMacOS } from '@platform/runtime';

/** Functional navigation disappears completely when collapsed. */
export default function WorkspaceSidebar() {
  const area = useWorkspaceNavigation(state => state.area);
  const collapsed = useWorkspaceNavigation(state => state.collapsed);
  const settingsOpen = useUiStore(state => state.settingsOpen);
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
    { id: 'terminal' as const, label: t('Terminal workspace'), Icon: TerminalPrompt },
    { id: 'code' as const, label: t('Code workspace'), Icon: FileCode },
    { id: 'ai' as const, label: t('AI workspace'), Icon: Sparkles },
    { id: 'ssh' as const, label: t('SSH hosts'), Icon: Server },
  ];
  return <aside className="workspace-sidebar" data-collapsed={collapsed} data-testid="workspace-sidebar" inert={collapsed} aria-hidden={collapsed || undefined}>
    <div className="workspace-sidebar-heading" data-tauri-drag-region>
      <span data-tauri-drag-region>{t('Workspaces')}</span>
      <div className="workspace-sidebar-header-actions">
        <IconButton compact data-testid="workspace-history" aria-label={t('Session history')} data-tip={t('Session history')} onClick={() => useSessionStore.getState().openHistoryTab()}><History size={iconSizes.control} /></IconButton>
        <IconButton compact className="workspace-sidebar-toggle" data-testid="workspace-sidebar-toggle" aria-label={t('Collapse sidebar')} data-tip={t('Collapse sidebar')}
          onClick={() => useWorkspaceNavigation.getState().setCollapsed(true)}><PanelLeft size={iconSizes.control} /></IconButton>
      </div>
    </div>
    <nav aria-label={t('Workspaces')} className="workspace-area-navigation">
      {items.map(({ id, label, Icon }) => <SidebarItem compact key={id} title={label} icon={<Icon size={iconSizes.row} />} active={!settingsOpen && area === id}
        testId={`workspace-area-${id}`} dataAttributes={{ role: 'button', 'aria-label': label, 'data-dock-btn': id === 'terminal' ? 'tabs' : id === 'ssh' ? 'ssh' : undefined, 'aria-current': !settingsOpen && area === id ? 'page' : undefined }} tabIndex={0}
        onClick={() => selectWorkspaceArea(id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectWorkspaceArea(id); } }} />)}
    </nav>
    <div className="workspace-sidebar-tools" />
    <div className="workspace-sidebar-footer">
      <SidebarItem compact title={t('Settings')} icon={<Settings size={iconSizes.row} />} active={settingsOpen} dataAttributes={{ 'data-dock-btn': 'settings', 'data-dock-fixed': 'true', role: 'button', 'aria-label': t('Settings'), 'aria-pressed': String(settingsOpen), 'data-tip-shortcut': `${isMacOS ? 'Meta' : 'Control'}+,` }} testId="workspace-settings" tabIndex={0}
        onClick={() => useUiStore.getState().setSettingsOpen(!settingsOpen)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); useUiStore.getState().setSettingsOpen(!settingsOpen); } }} />
    </div>
    <NavigationDragPreview />
  </aside>;
}
