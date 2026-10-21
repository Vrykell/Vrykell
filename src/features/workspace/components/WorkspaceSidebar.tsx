import { useEffect, useState } from 'react';
import { t } from '@i18n';
import SidebarItem from '@ui/sidebarItem';
import { IconButton } from '@ui/IconButton';
import { TerminalPrompt, FileCode, Sparkles, Server, Settings, Navigation, History, iconSizes } from '@ui/icons';
import { useSessionStore, useUiStore } from '@features/workspace';
import { useWorkspaceNavigation, WORKSPACE_COMPACT_BREAKPOINT } from '../stores/navigation';
import { selectWorkspaceArea } from '../services/selectWorkspaceArea';
import NavigationDragPreview from './NavigationDragPreview';
import { isMacOS } from '@platform/runtime';

/** Full-height functional navigation remains useful when reduced to an icon rail. */
export default function WorkspaceSidebar() {
  const area = useWorkspaceNavigation(state => state.area);
  const collapsed = useWorkspaceNavigation(state => state.collapsed);
  const settingsOpen = useUiStore(state => state.settingsOpen);
  const [narrow, setNarrow] = useState(window.innerWidth <= WORKSPACE_COMPACT_BREAKPOINT);
  useEffect(() => {
    const resize = () => setNarrow(window.innerWidth <= WORKSPACE_COMPACT_BREAKPOINT);
    window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize);
  }, []);
  const compact = collapsed || narrow;
  const items = [
    { id: 'terminal' as const, label: t('Terminal workspace'), Icon: TerminalPrompt },
    { id: 'code' as const, label: t('Code workspace'), Icon: FileCode },
    { id: 'ai' as const, label: t('AI workspace'), Icon: Sparkles },
    { id: 'ssh' as const, label: t('SSH hosts'), Icon: Server },
  ];
  return <aside className="workspace-sidebar" data-collapsed={compact} data-testid="workspace-sidebar">
    <div className="workspace-sidebar-heading" data-tauri-drag-region>
      <span data-tauri-drag-region>{t('Workspaces')}</span>
      <IconButton data-testid="workspace-sidebar-toggle" aria-label={t(compact ? 'Expand sidebar' : 'Collapse sidebar')} data-tip={t(compact ? 'Expand sidebar' : 'Collapse sidebar')}
        disabled={narrow} onClick={() => useWorkspaceNavigation.getState().setCollapsed(!collapsed)}><Navigation size={iconSizes.control} /></IconButton>
    </div>
    <nav aria-label={t('Workspaces')} className="workspace-area-navigation">
      {items.map(({ id, label, Icon }) => <SidebarItem key={id} title={label} icon={<Icon size={iconSizes.row} />} active={!settingsOpen && area === id}
        testId={`workspace-area-${id}`} dataAttributes={{ role: 'button', 'aria-label': label, 'data-dock-btn': id === 'terminal' ? 'tabs' : id === 'ssh' ? 'ssh' : undefined, 'aria-current': !settingsOpen && area === id ? 'page' : undefined }} tooltip={compact ? label : undefined} tabIndex={0}
        onClick={() => selectWorkspaceArea(id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectWorkspaceArea(id); } }} />)}
    </nav>
    <div className="workspace-sidebar-tools" />
    <div className="workspace-sidebar-footer">
      <SidebarItem title={t('Session history')} icon={<History size={iconSizes.row} />} active={false} dataAttributes={{ role: 'button', 'aria-label': t('Session history') }} tooltip={compact ? t('Session history') : undefined} tabIndex={0}
        onClick={() => useSessionStore.getState().openHistoryTab()} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); useSessionStore.getState().openHistoryTab(); } }} />
      <SidebarItem title={t('Settings')} icon={<Settings size={iconSizes.row} />} active={settingsOpen} dataAttributes={{ 'data-dock-btn': 'settings', 'data-dock-fixed': 'true', role: 'button', 'aria-label': t('Settings'), 'aria-pressed': String(settingsOpen), 'data-tip-shortcut': `${isMacOS ? 'Meta' : 'Control'}+,` }} tooltip={compact ? t(settingsOpen ? 'Close settings' : 'Open settings') : undefined} testId="workspace-settings" tabIndex={0}
        onClick={() => useUiStore.getState().setSettingsOpen(!settingsOpen)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); useUiStore.getState().setSettingsOpen(!settingsOpen); } }} />
    </div>
    <NavigationDragPreview />
  </aside>;
}
