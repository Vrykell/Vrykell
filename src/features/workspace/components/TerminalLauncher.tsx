import { useEffect, useState } from 'react';
import { t } from '@i18n';
import { ArrowRight, ChevronRight, Search, MoreHorizontal } from '@ui/icons';
import { IconBtn } from '@ui/actions/UiBtn';
import { OutlineButton } from '@ui/actions/OutlineButton';
import { TextInput } from '@ui/fields/TextInput';
import { TerminalIcon, TerminalProfileIcon } from '@ui/icons/shellIcons';
import { getAvailableShells, type ShellOption } from '@platform/shells';
import { isMacOS } from '@platform/runtime';
import { useShellProfiles } from '@config/shellProfiles';
import { useSessionStore, terminalsOf } from '@features/workspace';
import { ensureSshLoaded, useSshStore } from '@features/ssh';
import { connectionTarget } from '@features/ssh/services/api';
import { useSettingsNavigationStore } from '@features/settings/stores/navigation';
import { selectWorkspaceArea } from '../services/selectWorkspaceArea';
import { useDefaultShellType } from '../hooks/useDefaultShellType';
import NewTabModal from './NewTabModal';
import LaunchStats from './LaunchStats';

export default function TerminalLauncher() {
  const [shells, setShells] = useState<ShellOption[]>([]);
  const [query, setQuery] = useState('');
  const [optionsOpen, setOptionsOpen] = useState(false);
  const profiles = useShellProfiles(state => state.profiles);
  const hosts = useSshStore(state => state.connections);
  const tabs = useSessionStore(state => state.tabs);
  const configuredShell = useDefaultShellType();
  const defaultShell = configuredShell ?? shells.find(shell => shell.default)?.id ?? (isMacOS ? 'zsh' : 'powershell');
  useEffect(() => {
    let disposed = false;
    void getAvailableShells().then(entries => { if (!disposed) setShells(entries); });
    ensureSshLoaded();
    return () => { disposed = true; };
  }, []);
  const needle = query.trim().toLocaleLowerCase();
  const visible = shells.filter(shell => !profiles[shell.id]?.hidden && (!needle || `${profiles[shell.id]?.name || shell.label} ${shell.id}`.toLocaleLowerCase().includes(needle)));
  const recent = [...hosts].sort((first, second) => (second.lastOpenedAt ?? 0) - (first.lastOpenedAt ?? 0)).slice(0, 4);
  const sessions = tabs.filter(tab => tab.kind === 'session').reduce((count, tab) => count + terminalsOf(tab).length, 0);
  return <div className="workspace-launch-page" data-testid="start-page"><section className="ai-launchpad terminal-launchpad">
    <header className="ai-launch-header"><h2 className="ai-launch-title">{t('Start a terminal')}</h2><p className="ai-launch-description">{t('Choose a shell profile or connect to a saved host.')}</p></header>
    <div className="ai-launch-body">
      <button type="button" className="ai-launch-option ai-launch-native" data-testid="terminal-start-new"
        onClick={() => useSessionStore.getState().addTab()}><TerminalIcon size={32} /><span className="ai-launch-copy"><strong>{t('New terminal')}</strong><small>{profiles[defaultShell]?.name || shells.find(shell => shell.id === defaultShell)?.label || t('Use the default profile')}</small></span><ArrowRight size={18} /></button>
      <LaunchStats items={[{ label: t('Open terminals'), value: sessions }, { label: t('Shell profiles'), value: shells.length }, { label: t('Saved hosts'), value: hosts.length }]} />
      <section className="ai-launch-agents" aria-label={t('Shell profiles')}>
        <div className="ai-launch-section-heading"><h3>{t('Shell profiles')}<span>{shells.length}</span></h3><div className="ai-launch-section-actions"><OutlineButton onClick={() => {
          useSettingsNavigationStore.getState().setSelected(`profile:${defaultShell}`);
          useSessionStore.getState().openSettings();
        }}>{t('Configure profiles')}</OutlineButton><IconBtn title={t('New terminal options')} onClick={() => setOptionsOpen(true)}><MoreHorizontal size={18} /></IconBtn></div></div>
        <div className="workspace-sidebar-search ai-launch-search"><Search size={16} /><TextInput value={query} onChange={event => setQuery(event.target.value)} aria-label={t('Search shell profiles')} placeholder={t('Search shell profiles')} /></div>
        <div className="ai-launch-grid">{visible.map(shell => <button type="button" className="ai-launch-option" key={shell.id} data-testid={`terminal-start-profile-${shell.id}`} onClick={() => useSessionStore.getState().addTab({ shellType: shell.id })}>
          <TerminalProfileIcon shellType={shell.id} size={28} /><span className="ai-launch-copy"><strong>{profiles[shell.id]?.name || shell.label}</strong><small>{profiles[shell.id]?.cwd || t('Inherit current directory')}</small></span><ChevronRight size={16} />
        </button>)}</div>
        {!visible.length && <div className="search-empty-state">{t(shells.length ? 'No matching profiles' : 'Loading…')}</div>}
      </section>
      {!!hosts.length && <section className="ai-launch-agents" aria-label={t('Saved hosts')}><div className="ai-launch-section-heading"><h3>{t('Saved hosts')}</h3><OutlineButton onClick={() => selectWorkspaceArea('ssh')}>{t('All hosts')}</OutlineButton></div>
        <div className="ai-launch-grid">{recent.map(host => <button type="button" className="ai-launch-option" key={host.id} data-testid={`terminal-start-host-${host.id}`} onClick={() => {
          void useSshStore.getState().touch(host.id);
          useSessionStore.getState().addTab({ kind: 'ssh', ssh: connectionTarget(host) });
        }}><TerminalProfileIcon kind="ssh" connectionId={host.id} size={28} /><span className="ai-launch-copy"><strong>{host.name}</strong><small>{host.user ? `${host.user}@` : ''}{host.host}:{host.port ?? 22}</small></span><ChevronRight size={16} /></button>)}</div>
      </section>}
    </div>
    <NewTabModal open={optionsOpen} onClose={() => setOptionsOpen(false)} />
  </section></div>;
}
