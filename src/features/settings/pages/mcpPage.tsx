/**
 * mcpPage — MCP 服务器设置页。
 * New server drafts are persisted automatically after required fields are valid.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, X } from '@ui/icons';
import {
  listMcpServers, saveMcpServer, removeMcpServer, toggleMcpServer,
  connectMcp, disconnectMcp, type McpServer,
} from '@features/agent/services/mcp';
import { useToastStore } from '@ui/Toast';
import ErrorBox from '@ui/ErrorBox';
import { Field, Toggle, inputStyle, btnStyle } from '@features/settings/components/ui';
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
      toast(`已连接 ${name}`, 'success');
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
      toast(`已删除 ${name}`, 'success');
      refresh();
    } catch (e) {
      toast(String((e as Error)?.message ?? e), 'error');
    }
  };

  const addNew = () => setDrafts((d) => [...d, `d${Date.now()}-${d.length}`]);
  const dropDraft = (key: string) => setDrafts((d) => d.filter((x) => x !== key));

  return (
    <Field
      title="MCP 服务器"
      description="接入外部工具服务器。本地服务器填 command 与 args，连接后工具即注册给 AI。"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {listError && (
          <ErrorBox actions={<button onClick={refresh} style={{ minHeight: 32 }}>重试</button>}>
            {listError}
          </ErrorBox>
        )}
        {!listError && servers.length === 0 && drafts.length === 0 && (
          <div style={{ fontSize: 'calc(12px * var(--ui-font-scale))', color: 'var(--text-muted)', padding: '6px 0' }}>
            还没有 MCP 服务器，点下方「添加服务器」创建一个。
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
        <button
          onClick={addNew}
          style={{ ...btnStyle, display: 'inline-flex', alignItems: 'center', gap: 4, alignSelf: 'flex-start' }}
        >
          <Plus size={12} /> 添加服务器
        </button>
      </div>
    </Field>
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
      if (existing.some(server => server.name === name)) throw new Error('服务器名已存在');
    }
    await saveMcpServer({ name, command: next.command.trim(), args: next.args.split(/\s+/).filter(Boolean),
      env: parseEnvLines(next.env), url: next.url.trim(), enabled: next.enabled });
    if (savedName.current && savedName.current !== name) await removeMcpServer(savedName.current);
    savedName.current = name;
    onSaved();
  }, next => !next.name.trim() ? '请填写服务器名' : !next.command.trim() && !next.url.trim() ? '请填写命令或远程地址' : undefined);
  const { name, command, args, url, env, enabled } = saving.value;
  const change = (patch: Partial<typeof initial>, immediate = false) => saving.setValue(previous => ({ ...previous, ...patch }), immediate);
  const discard = async (operation: () => void) => { await saving.cancel(); operation(); };

  return (
    <div
      onCompositionStart={() => saving.setComposing(true)} onCompositionEnd={() => saving.setComposing(false)}
      style={{
        borderRadius: 'var(--radius-inner)',
        padding: '10px 12px', background: 'var(--canvas)', opacity: enabled ? 1 : 0.6,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <input
          value={name}
          placeholder="服务器名"
          onChange={(e) => change({ name: e.target.value })}
          style={{ ...inputStyle, flex: 1, fontWeight: 600, minWidth: 120 }}
        />
        {s && (
          <span style={{
            fontSize: 'calc(11px * var(--ui-font-scale))', padding: '2px 8px', borderRadius: 4, flexShrink: 0,
            color: s.connected ? 'var(--success)' : 'var(--text-muted)',
            background: s.connected ? 'var(--success-bg)' : 'var(--hover)',
          }}>
            {s.connected ? `已连接 · ${s.toolCount} 工具` : '未连接'}
          </span>
        )}
        {s && <Toggle on={enabled} onChange={enabled => change({ enabled }, true)} />}
        <SaveStatus status={saving.status} error={saving.error} onRetry={() => { void saving.flush(); }} />
        {s && s.connected && (
          <button onClick={() => { void saving.flush().then(() => { if (!saving.hasPending()) onDisconnect(savedName.current); }); }} disabled={busy} style={{ ...btnStyle, flexShrink: 0 }}>断开</button>
        )}
        {s && !s.connected && (
          <button onClick={() => { void saving.flush().then(() => { if (!saving.hasPending()) onConnect(savedName.current); }); }} disabled={busy} style={{ ...btnStyle, flexShrink: 0 }}>
            {busy ? '连接中…' : '连接'}
          </button>
        )}
        {draft && onCancel && (
          <button onClick={() => { void discard(onCancel); }} style={{ ...btnStyle, flexShrink: 0 }}>取消</button>
        )}
        {s && (
          <button
            onClick={() => { void discard(() => onDelete(savedName.current)); }}
            data-tip="删除服务器"
            aria-label="删除服务器"
            style={{
              width: 26, height: 26, flexShrink: 0, display: 'inline-flex', alignItems: 'center',
              justifyContent: 'center', border: '1px solid transparent', borderRadius: 4,
              background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--error-light)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
          >
            <X size={13} />
          </button>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <input
          value={command}
          placeholder="command，如 npx"
          onChange={(e) => change({ command: e.target.value })}
          style={{ ...inputStyle, flex: 1 }}
        />
        <input
          value={args}
          placeholder="args，空格分隔"
          onChange={(e) => change({ args: e.target.value })}
          style={{ ...inputStyle, flex: 1 }}
        />
      </div>
      <input
        value={url}
        placeholder="远程 URL，可选"
        onChange={(e) => change({ url: e.target.value })}
        style={{ ...inputStyle, marginTop: 8 }}
      />
      <textarea
        value={env}
        placeholder={'环境变量，每行 KEY=VALUE'}
        onChange={(e) => change({ env: e.target.value })}
        rows={3}
        style={{
          ...inputStyle, marginTop: 8, minHeight: 52, resize: 'vertical',
          fontFamily: 'var(--font-mono)', lineHeight: 1.5,
        }}
      />
    </div>
  );
}
