import { useEffect, useMemo, useRef, useState } from 'react';
import { t } from '@i18n';
import { ChevronRight, FolderOpen, iconSizes, Search, Settings } from '@ui/icons';
import { TextInput } from '@ui/fields/TextInput';
import { OutlineButton } from '@ui/actions/OutlineButton';
import ErrorBox from '@ui/feedback/ErrorBox';
import AnchoredDropdown, { type DropdownAnchor } from '@ui/menus/AnchoredDropdown';
import { useSettingsNavigationStore } from '@features/settings/stores/navigation';
import { harnessMark } from '@features/agent/components/HarnessBadge';
import { useSessionStore, useUiStore } from '@features/workspace';
import { acpHarnesses, acpWorkspaceRoot } from '@platform/api/acp';
import { invoke } from '@platform/diagnostics';
import { agentCatalog, type AgentEntry, type AgentInstance } from '@features/chat/model/agentCatalog';
import { createAgentSession } from '@features/chat/services/agentDrivers';
import type { HarnessConfig } from '@platform/api/acp';
import { useAiConfigStore } from '@features/agent';
import { pickPath } from '@platform/api/fs';

export default function AgentLauncher({
  open,
  onClose,
  suspended = false,
  onPick,
  cwd,
  anchor,
}: {
  open: boolean;
  onClose: () => void;
  suspended?: boolean;
  onPick?: (instance: AgentInstance, cwd?: string) => void;
  cwd?: string;
  anchor?: DropdownAnchor;
}) {
  const [list, setList] = useState<HarnessConfig[] | null>(null);
  const [installed, setInstalled] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const [keyboardNavigation, setKeyboardNavigation] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [directory, setDirectory] = useState(cwd ?? '');
  const [workspaceRoot, setWorkspaceRoot] = useState('');
  const settingsOpen = useUiStore((state) => state.settingsOpen);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (open && settingsOpen) close.current();
  }, [open, settingsOpen]);
  const models = useAiConfigStore((state) => state.models);
  const activeModel = useAiConfigStore((state) => state.activeModel);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setDirectory(cwd ?? '');
    setError('');
    setList(null);
    setSelected(0);
    setKeyboardNavigation(false);
    requestAnimationFrame(() => inputRef.current?.focus());
    let current = true;
    void acpHarnesses()
      .then((entries) => {
        if (current) setList(entries);
      })
      .catch((error: unknown) => {
        if (current) setError(String(error));
      });
    void acpWorkspaceRoot()
      .then((root) => setWorkspaceRoot(typeof root === 'string' ? root : ''))
      .catch(() => setWorkspaceRoot(''));
    return () => {
      current = false;
    };
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

  const catalog = useMemo(
    () => agentCatalog(list ?? [], models.find((model) => model.id === activeModel)?.name),
    [list, models, activeModel],
  );
  const ready = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return catalog.filter((entry) => !needle || `${entry.label} ${entry.detail}`.toLowerCase().includes(needle));
  }, [catalog, query]);

  useEffect(() => setSelected(0), [query]);

  const start = (entry: AgentEntry) => {
    const cwd = directory.trim() || undefined;
    if (onPick) onPick(entry.instance, cwd);
    else {
      createAgentSession(entry.instance, 'main', cwd);
      useSessionStore.getState().openHarnessTab();
    }
    onClose();
  };

  const handleKey = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' && event.target instanceof HTMLButtonElement) return;
    if (event.key === 'Escape') onClose();
    else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setKeyboardNavigation(true);
      setSelected((value) => Math.min(value + 1, ready.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setKeyboardNavigation(true);
      setSelected((value) => Math.max(value - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const entry = ready[selected];
      if (entry && entry.enabled && (!entry.command || installed[entry.command] !== false)) start(entry);
    }
  };

  const configure = () => {
    onClose();
    useSettingsNavigationStore.getState().openField('ai-harness', t('ACP'));
    useSessionStore.getState().openSettings();
  };
  if (!open || suspended) return null;
  const folder = (
    <div className="acp-launch-directory">
      <TextInput
        variant="field"
        value={directory}
        aria-label={t('Project folder')}
        data-testid="acp-launcher-directory"
        data-tip={workspaceRoot ? t('New folder in {{path}}', { path: workspaceRoot }) : t('Project folder')}
        placeholder={t('Project folder (optional)')}
        onChange={(event) => setDirectory(event.target.value)}
      />
      <OutlineButton
        aria-label={t('Choose project folder')}
        onClick={() => {
          void pickPath('directory')
            .then(([path]) => {
              if (path) setDirectory(path);
            })
            .catch((reason) => setError(String(reason)));
        }}>
        <FolderOpen size={16} />
      </OutlineButton>
    </div>
  );

  return (
    <AnchoredDropdown
      open={open}
      onClose={onClose}
      panelRef={dialogRef}
      anchor={anchor}
      aria-label={t('Choose agent')}
      className="acp-profile-dropdown"
      data-testid="acp-launcher"
      data-embedded="false"
      data-keyboard-navigation={keyboardNavigation}
      onPointerMove={() => setKeyboardNavigation(false)}
      onKeyDown={handleKey}>
      <section className="new-tab-section">
        <h2>
          {t('Agents')}
          {list ? ` · ${catalog.length}` : ''}
        </h2>
        {folder}
        <button type="button" className="new-tab-row workspace-floating-row" onClick={configure}>
          <Settings size={20} />
          <span>{t('Configure servers')}</span>
          <ChevronRight size={16} />
        </button>
        <div className="workspace-sidebar-search acp-profile-search">
          <Search size={iconSizes.compact} />
          <TextInput
            ref={inputRef}
            value={query}
            data-testid="acp-launcher-search"
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('Search agents…')}
            aria-label={t('Search agents…')}
          />
        </div>
        {error && (
          <ErrorBox
            title={t('Could not load servers')}
            details={error}
            actions={<OutlineButton onClick={() => setRevision((value) => value + 1)}>{t('Retry')}</OutlineButton>}
          />
        )}
        {!list && !error && (
          <div className="new-tab-empty" role="status">
            {t('Loading…')}
          </div>
        )}
        {list && !ready.length && (
          <div className="new-tab-empty" data-testid="acp-launcher-none">
            {t('No matching agents')}
          </div>
        )}
        <div className="new-tab-option-list acp-profile-list">
          {ready.map((entry, index) => {
            const missing = !!entry.command && installed[entry.command] === false;
            const usable = entry.enabled && !missing;
            const Mark = harnessMark(entry.label);
            const status = t(missing ? 'Not installed on PATH' : entry.enabled ? 'Ready' : 'Disabled');
            return (
              <button
                type="button"
                key={entry.id}
                className="new-tab-row workspace-floating-row"
                data-testid={entry.instance.driver === 'builtin' ? 'agent-launcher-builtin' : `acp-launcher-${entry.label}`}
                data-keyboard-active={keyboardNavigation && selected === index}
                disabled={!usable}
                data-tip={`${entry.label} · ${entry.detail} · ${status}`}
                onMouseEnter={() => {
                  setSelected(index);
                  setKeyboardNavigation(false);
                }}
                onClick={() => start(entry)}>
                <span className="identity-icon" data-colored="true">
                  <Mark size={20} />
                </span>
                <span>{entry.label}</span>
                <small className="acp-profile-status">{status}</small>
              </button>
            );
          })}
        </div>
      </section>
    </AnchoredDropdown>
  );
}
