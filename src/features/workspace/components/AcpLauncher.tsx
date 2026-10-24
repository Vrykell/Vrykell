import { useEffect, useMemo, useRef, useState } from 'react';
import { t } from '@i18n';
import { ArrowRight, ChevronRight, iconSizes, Search, Settings } from '@ui/icons';
import { TextInput } from '@ui/TextInput';
import { OutlineButton } from '@ui/OutlineButton';
import ErrorBox from '@ui/ErrorBox';
import AnchoredDropdown from '@ui/AnchoredDropdown';
import { useSettingsNavigationStore } from '@features/settings/stores/navigation';
import { harnessMark } from '@features/agent/components/HarnessBadge';
import { useSessionStore, useUiStore } from '@features/workspace';
import { acpHarnesses } from '@platform/api/acp';
import { invoke } from '@platform/diagnostics';
import AppMark from '@ui/AppMark';
import { useAiConfigStore, useUsageStore } from '@features/agent';
import { formatCompact } from '@features/agent/model/usageStats';
import LaunchStats from './LaunchStats';

interface LauncherEntry {
  name: string;
  command: string;
  args: string[];
  enabled: boolean;
}

export default function AcpLauncher({ open, onClose, embedded = false, suspended = false, onPick, onNewConversation }: {
  open: boolean; onClose: () => void; embedded?: boolean; suspended?: boolean; onPick?: (name: string) => void; onNewConversation?: () => void;
}) {
  const [list, setList] = useState<LauncherEntry[] | null>(null);
  const [installed, setInstalled] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const [keyboardNavigation, setKeyboardNavigation] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const settingsOpen = useUiStore(state => state.settingsOpen);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => { if (open && !embedded && settingsOpen) close.current(); }, [open, embedded, settingsOpen]);
  const records = useUsageStore(state => state.records);
  const usage = useUsageStore(state => state.acp);
  const models = useAiConfigStore(state => state.models);
  const activeModel = useAiConfigStore(state => state.activeModel);
  const today = useMemo(() => {
    const since = new Date().setHours(0, 0, 0, 0);
    const current = records.filter(record => record.at >= since);
    return { turns: current.length, tokens: current.reduce((sum, record) => sum + record.inputTokens + record.outputTokens, 0) };
  }, [records]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setError('');
    setList(null);
    setSelected(onNewConversation ? -1 : 0);
    setKeyboardNavigation(false);
    requestAnimationFrame(() => inputRef.current?.focus());
    void acpHarnesses()
      .then((entries) => setList(entries.map((entry) => ({
        name: entry.name, command: entry.command, args: entry.args, enabled: entry.enabled,
      }))))
      .catch((error: unknown) => setError(String(error)));
  }, [open, revision]);

  useEffect(() => {
    if (!open || !list) return;
    for (const entry of list) {
      const command = entry.command.trim();
      if (!command || command in installed) continue;
      void invoke<boolean>('which_cmd', { cmd: command })
        .then((found) => setInstalled((current) => ({ ...current, [command]: found })))
        .catch(() => setInstalled((current) => ({ ...current, [command]: true })));
    }
  }, [open, list, installed]);

  const ready = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (list ?? []).filter((entry) => !needle
      || `${entry.name} ${entry.command} ${entry.args.join(' ')}`.toLowerCase().includes(needle));
  }, [list, query]);

  useEffect(() => setSelected(onNewConversation ? -1 : 0), [query, Boolean(onNewConversation)]);

  const start = (entry: LauncherEntry) => {
    if (onPick) onPick(entry.name);
    else useSessionStore.getState().openHarnessTab(entry.name);
    onClose();
  };

  const handleKey = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' && event.target instanceof HTMLButtonElement) return;
    if (event.key === 'Escape' && !embedded) onClose();
    else if (event.key === 'ArrowDown') { event.preventDefault(); setKeyboardNavigation(true); setSelected((value) => Math.min(value + 1, ready.length - 1)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setKeyboardNavigation(true); setSelected((value) => Math.max(value - 1, onNewConversation ? -1 : 0)); }
    else if (event.key === 'Enter') {
      event.preventDefault();
      if (selected === -1 && onNewConversation) { onNewConversation(); onClose(); return; }
      const entry = ready[selected];
      if (entry && entry.enabled && installed[entry.command.trim()] !== false) start(entry);
    }
  };

  const configure = () => {
    onClose();
    useSettingsNavigationStore.getState().openField('ai-harness', t('ACP'));
    useSessionStore.getState().openSettings();
  };
  if (!open || suspended) return null;

  if (!embedded) return <AnchoredDropdown open={open} onClose={onClose} panelRef={dialogRef} aria-label={t('ACP')}
    className="acp-profile-dropdown" data-testid="acp-launcher" data-embedded="false" data-keyboard-navigation={keyboardNavigation}
    onPointerMove={() => setKeyboardNavigation(false)} onKeyDown={handleKey}>
    <section className="new-tab-section">
      <h2>{t('ACP agents')}{list ? ` · ${list.length}` : ''}</h2>
      <button type="button" className="new-tab-row workspace-floating-row" onClick={configure}><Settings size={20} /><span>{t('Configure servers')}</span><ChevronRight size={16} /></button>
      <div className="workspace-sidebar-search acp-profile-search"><Search size={iconSizes.compact} /><TextInput ref={inputRef} value={query}
        data-testid="acp-launcher-search" onChange={event => setQuery(event.target.value)} placeholder={t('Search servers…')} aria-label={t('Search servers…')} /></div>
      {error && <ErrorBox title={t('Could not load servers')} details={error} actions={<OutlineButton onClick={() => setRevision(value => value + 1)}>{t('Retry')}</OutlineButton>} />}
      {!list && !error && <div className="new-tab-empty" role="status">{t('Loading…')}</div>}
      {list && !ready.length && <div className="new-tab-empty" data-testid="acp-launcher-none">{t(list.length ? 'No matching servers' : 'No agents configured')}</div>}
      <div className="new-tab-option-list acp-profile-list">
        {ready.map((entry, index) => {
          const missing = installed[entry.command.trim()] === false;
          const usable = entry.enabled && !missing; const Mark = harnessMark(entry.name);
          const status = t(missing ? 'Not installed on PATH' : entry.enabled ? 'Ready' : 'Disabled');
          return <button type="button" key={entry.name} className="new-tab-row workspace-floating-row" data-testid={`acp-launcher-${entry.name}`}
            data-keyboard-active={keyboardNavigation && selected === index} disabled={!usable} data-tip={`${entry.name} · ${entry.command} ${entry.args.join(' ')} · ${status}`}
            onMouseEnter={() => { setSelected(index); setKeyboardNavigation(false); }} onClick={() => start(entry)}>
            <span className="identity-icon" data-colored="true"><Mark size={20} /></span><span>{entry.name}</span><small className="acp-profile-status">{status}</small>
          </button>;
        })}
      </div>
    </section>
  </AnchoredDropdown>;

  const content = <div ref={dialogRef} data-testid="acp-launcher" data-embedded={embedded}
    data-keyboard-navigation={keyboardNavigation} onPointerMove={() => setKeyboardNavigation(false)}
    className={embedded ? 'ai-launchpad' : 'workspace-floating workspace-floating-dialog ai-launchpad'}
    role={embedded ? 'region' : 'dialog'} aria-modal={embedded ? undefined : true} aria-label={t('ACP')}
    onClick={event => event.stopPropagation()} onKeyDown={handleKey}>
    <header className="ai-launch-header">
      <h2 className="ai-launch-title">{t(onNewConversation ? 'Start a conversation' : 'ACP')}</h2>
      {embedded && <p className="ai-launch-description">{t('Choose a conversation or a connected agent.')}</p>}
    </header>
    <div className="ai-launch-body">
      {onNewConversation && <button type="button" className="ai-launch-option ai-launch-native" data-testid="ai-start-new-conversation" data-keyboard-active={keyboardNavigation && selected === -1}
        onMouseEnter={() => { setSelected(-1); setKeyboardNavigation(false); }} onClick={() => { onNewConversation(); onClose(); }}>
        <AppMark size={32} /><span className="ai-launch-copy"><strong>{t('New conversation')}</strong><small>{models.find(model => model.id === activeModel)?.name || t('Chat with your configured models')}</small></span><ArrowRight size={iconSizes.control} />
      </button>}
      {embedded && <LaunchStats items={[
        { label: t('Requests today'), value: formatCompact(today.turns) },
        { label: t('Tokens today'), value: formatCompact(today.tokens) },
        { label: t('Configured models'), value: models.length },
      ]} />}
      <section className="ai-launch-agents" aria-label={t('ACP agents')}>
        <div className="ai-launch-section-heading">
          <h3>{t('ACP agents')}{list && <span>{list.length}</span>}</h3>
          <OutlineButton onClick={configure}>{t('Configure servers')}</OutlineButton>
        </div>
        <div className="workspace-sidebar-search ai-launch-search">
          <Search size={iconSizes.compact} />
          <TextInput ref={inputRef} value={query} data-testid="acp-launcher-search"
            onChange={event => setQuery(event.target.value)} placeholder={t('Search servers…')} aria-label={t('Search servers…')} />
        </div>
        {error && <ErrorBox title={t('Could not load servers')} details={error}
          actions={<OutlineButton onClick={() => setRevision(value => value + 1)}>{t('Retry')}</OutlineButton>} />}
        {!list && !error && <div className="ai-launch-empty" role="status">{t('Loading…')}</div>}
        {list && ready.length === 0 && <div className="ai-launch-empty" data-testid="acp-launcher-none">{t(list.length ? 'No matching servers' : 'No agents configured')}</div>}
        <div className="ai-launch-grid">
          {ready.map((entry, index) => {
            const missing = installed[entry.command.trim()] === false;
            const usable = entry.enabled && !missing;
            const Mark = harnessMark(entry.name);
            return <button key={entry.name} type="button" className="ai-launch-option"
              data-keyboard-active={keyboardNavigation && index === selected} data-testid={`acp-launcher-${entry.name}`} disabled={!usable}
              onClick={() => start(entry)} onMouseEnter={() => { setSelected(index); setKeyboardNavigation(false); }}>
              <span className="identity-icon" data-colored="true"><Mark size={28} /></span>
              <span className="ai-launch-copy"><strong>{entry.name}</strong><small>{entry.command} {entry.args.join(' ')}</small></span>
              <ChevronRight size={iconSizes.compact} />
              <span className="ai-launch-availability" data-ready={usable} data-missing={missing}>{missing ? t('Not installed on PATH') : entry.enabled ? t('Ready') : t('Disabled')}
                <span className="ai-launch-usage">{t('{{count}} turns', { count: usage[entry.name]?.turns ?? 0 })}</span></span>
            </button>;
          })}
        </div>
      </section>
    </div>
  </div>;
  return content;
}
