import { OutlineButton } from '@ui/actions/OutlineButton';
import ConfigTextArea from '@ui/fields/ConfigTextArea';
import { IconButton } from '@ui/actions/IconButton';
import { t } from '@i18n';
import { TextInput } from '@ui/fields/TextInput';
/**
 * External tool server settings.
 * New server drafts are persisted automatically after required fields are valid.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, X } from '@ui/icons';
import {
  listMcpServers, saveMcpServer, removeMcpServer, toggleMcpServer,
  connectMcp, disconnectMcp, type McpServer,
} from '@features/agent/services/mcp';
import { useToastStore } from '@ui/feedback/Toast';
import ErrorBox from '@ui/feedback/ErrorBox';
import { SettingsGroup, Field, Toggle, inputStyle } from '@features/settings/components/ui';
import { useAutoSave } from '../hooks/useAutoSave';
import SaveStatus from '../components/SaveStatus';

function parseEnvLines(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

export function McpPage() {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [drafts, setDrafts] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [listError, setListError] = useState('');
  const toast = (msg: string, type: 'info' | 'success' | 'error') =>
    useToastStore.getState().addToast(msg, type);

  const refresh = () => {
    setListError('');
    listMcpServers()
      .then(setServers)
      .catch((e) => setListError(String((e as Error)?.message ?? e)));
  };
  useEffect(() => {
    refresh();
  }, []);

  const connect = async (name: string) => {
    setBusy(name);
    try {
      await connectMcp(name);
      toast(t('Connected to {{name}}', { name }), 'success');
    } catch (e) {
      toast(String((e as Error)?.message ?? e), 'error');
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const disconnect = async (name: string) => {
    setBusy(name);
    try {
      await disconnectMcp(name);
    } catch (e) {
      toast(String((e as Error)?.message ?? e), 'error');
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const del = async (name: string) => {
    try {
      await removeMcpServer(name);
      toast(t('Deleted {{name}}.', { name }), 'success');
      refresh();
    } catch (e) {
      toast(String((e as Error)?.message ?? e), 'error');
    }
  };

  const addNew = () => setDrafts((d) => [...d, `d${Date.now()}-${d.length}`]);
  const dropDraft = (key: string) => setDrafts((d) => d.filter((x) => x !== key));

  return (
    <SettingsGroup title={t('External tools')}><Field
      layout="stacked"
      title={t('MCP servers')}
      description={t('Connect external tools using a command and arguments or a server URL.')}
    >
      <div className="settings-record-list">
        {listError && (
          <ErrorBox actions={<button onClick={refresh} style={{ minHeight: 32 }}>{t('Retry')}</button>}>
            {listError}
          </ErrorBox>
        )}
        {!listError && servers.length === 0 && drafts.length === 0 && (
          <div style={{ fontSize: 'calc(12px * var(--ui-font-scale))', color: 'var(--text-muted)', padding: '6px 0' }}>
            {t('No MCP servers yet. Use Add server below to create one.')}
          </div>
        )}
        {servers.map((s) => (
          <McpServerCard
            key={s.name}
            s={s}
            busy={busy === s.name}
            onConnect={name => { void connect(name ?? s.name); }}
            onDisconnect={name => { void disconnect(name ?? s.name); }}
            onDelete={name => { void del(name ?? s.name); }}
            onSaved={refresh}
          />
        ))}
        {drafts.map((k) => (
          <McpServerCard
            key={k}
            draft
            busy={false}
            onConnect={() => {}}
            onDisconnect={() => {}}
            onDelete={() => {}}
            onSaved={() => { dropDraft(k); refresh(); }}
            onCancel={() => dropDraft(k)}
          />
        ))}
        <OutlineButton
          onClick={addNew}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, alignSelf: 'flex-start' }}
        >
          <Plus size={12} /> {t('Add server')}
        </OutlineButton>
      </div>
    </Field></SettingsGroup>
  );
}

function McpServerCard({ s, draft, busy, onConnect, onDisconnect, onDelete, onSaved, onCancel }: {
  s?: McpServer;
  draft?: boolean;
  busy: boolean;
  onConnect: (name?: string) => void;
  onDisconnect: (name?: string) => void;
  onDelete: (name?: string) => void;
  onSaved: () => void;
  onCancel?: () => void;
}) {
  const initial = useMemo(() => ({ name: s?.name ?? '', command: s?.command ?? '', args: s?.args.join(' ') ?? '',
    url: s?.url ?? '', env: s ? Object.entries(s.env).map(([k, v]) => `${k}=${v}`).join('\n') : '', enabled: s?.enabled ?? true }), [s]);
  const savedName = useRef(s?.name);
  const saving = useAutoSave(initial, async next => {
    const name = next.name.trim();
    if (s && name === s.name && next.command === initial.command && next.args === initial.args && next.url === initial.url && next.env === initial.env && next.enabled !== s.enabled) {
      await toggleMcpServer(s.name, next.enabled);
      onSaved();
      return;
    }
    if (savedName.current !== name) {
      const existing = await listMcpServers();
      if (existing.some(server => server.name === name)) throw new Error(t('A server with this name already exists.'));
    }
    await saveMcpServer({ name, command: next.command.trim(), args: next.args.split(/\s+/).filter(Boolean),
      env: parseEnvLines(next.env), url: next.url.trim(), enabled: next.enabled });
    if (savedName.current && savedName.current !== name) await removeMcpServer(savedName.current);
    savedName.current = name;
    onSaved();
  }, next => !next.name.trim() ? t('Enter a server name') : !next.command.trim() && !next.url.trim() ? t('Enter a command or a remote address') : undefined);
  const { name, command, args, url, env, enabled } = saving.value;
  const change = (patch: Partial<typeof initial>, immediate = false) => saving.setValue(previous => ({ ...previous, ...patch }), immediate);
  const discard = async (operation: () => void) => { await saving.cancel(); operation(); };

  return (
    <div
      className="settings-record"
      onCompositionStart={() => saving.setComposing(true)} onCompositionEnd={() => saving.setComposing(false)}
      style={{
        opacity: enabled ? 1 : 0.6,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <TextInput
          value={name}
          placeholder={t('Server name')}
          onChange={(e) => change({ name: e.target.value })}
          style={{ ...inputStyle, flex: 1, fontWeight: 'var(--fw-semibold)', minWidth: 120 }}
        />
        {s && (
          <span style={{
            fontSize: 'calc(11px * var(--ui-font-scale))', padding: '2px 8px', borderRadius: 4, flexShrink: 0,
            color: s.connected ? 'var(--success)' : 'var(--text-muted)',
            background: s.connected ? 'var(--success-bg)' : 'var(--hover)',
          }}>
            {s.connected ? t('Connected · {{count}} tools', { count: s.toolCount }) : t('Not connected')}
          </span>
        )}
        {s && <Toggle on={enabled} onChange={enabled => change({ enabled }, true)} />}
        <SaveStatus inline status={saving.status} error={saving.error} onRetry={() => { void saving.flush(); }} />
        {s && s.connected && (
          <OutlineButton onClick={() => { void saving.flush().then(() => { if (!saving.hasPending()) onDisconnect(savedName.current); }); }} disabled={busy} style={{ flexShrink: 0 }}>{t('Disconnect')}</OutlineButton>
        )}
        {s && !s.connected && (
          <OutlineButton onClick={() => { void saving.flush().then(() => { if (!saving.hasPending()) onConnect(savedName.current); }); }} disabled={busy} style={{ flexShrink: 0 }}>
            {busy ? t('Connecting…') : t('Connect')}
          </OutlineButton>
        )}
        {draft && onCancel && (
          <OutlineButton onClick={() => { void discard(onCancel); }} style={{ flexShrink: 0 }}>{t('Cancel')}</OutlineButton>
        )}
        {s && (
          <IconButton compact tone="danger" onClick={() => { void discard(() => onDelete(savedName.current)); }} data-tip={t('Delete server')} aria-label={t('Delete server')}><X size={16} /></IconButton>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <TextInput
          value={command}
          placeholder={t('Command, e.g. npx')}
          onChange={(e) => change({ command: e.target.value })}
          style={{ ...inputStyle, flex: 1 }}
        />
        <TextInput
          value={args}
          placeholder={t('Arguments, space-separated')}
          onChange={(e) => change({ args: e.target.value })}
          style={{ ...inputStyle, flex: 1 }}
        />
      </div>
      <TextInput
        value={url}
        placeholder={t('Remote URL, optional')}
        onChange={(e) => change({ url: e.target.value })}
        style={{ ...inputStyle, marginTop: 8 }}
      />
      <ConfigTextArea
        label={t('Environment variables')}
        value={env}
        placeholder={t('Environment variables, one KEY=VALUE per line')}
        onChange={(e) => change({ env: e.target.value })}
        rows={3}
        style={{
          ...inputStyle, marginTop: 8, minHeight: 52, resize: 'vertical',
          fontFamily: 'var(--font-ui)', lineHeight: 1.5,
        }}
      />
    </div>
  );
}
