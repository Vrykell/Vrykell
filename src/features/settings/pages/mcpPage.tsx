/**
 * mcpPage — MCP 服务器设置页。
 * 「添加服务器」先生成本地草稿卡片，填好 command/url 再保存落库。
 */
import { useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
import {
  listMcpServers, saveMcpServer, removeMcpServer, toggleMcpServer,
  connectMcp, disconnectMcp, type McpServer,
} from '@features/agent/mcp';
import { useToastStore } from '@/components/Toast';
import { Field, Toggle, inputStyle, btnStyle } from '@features/settings/components/ui';

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
  const toast = (msg: string, type: 'info' | 'success' | 'error') =>
    useToastStore.getState().addToast(msg, type);

  const refresh = () => {
    listMcpServers()
      .then(setServers)
      .catch((e) => toast(String((e as Error)?.message ?? e), 'error'));
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
        {servers.length === 0 && drafts.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '6px 0' }}>
            还没有 MCP 服务器，点下方「添加服务器」创建一个。
          </div>
        )}
        {servers.map((s) => (
          <McpServerCard
            key={s.name}
            s={s}
            busy={busy === s.name}
            onConnect={() => connect(s.name)}
            onDisconnect={() => disconnect(s.name)}
            onDelete={() => del(s.name)}
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
  onConnect: () => void;
  onDisconnect: () => void;
  onDelete: () => void;
  onSaved: () => void;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(s?.name ?? '');
  const [command, setCommand] = useState(s?.command ?? '');
  const [args, setArgs] = useState(s ? s.args.join(' ') : '');
  const [url, setUrl] = useState(s?.url ?? '');
  const [env, setEnv] = useState(s ? Object.entries(s.env).map(([k, v]) => `${k}=${v}`).join('\n') : '');
  const [enabled, setEnabled] = useState(s?.enabled ?? true);
  const toast = (msg: string, type: 'info' | 'success' | 'error') =>
    useToastStore.getState().addToast(msg, type);

  const save = async () => {
    if (!name.trim()) {
      toast('请填写服务器名', 'error');
      return;
    }
    if (!command.trim() && !url.trim()) {
      toast('请填写 command 或 url', 'error');
      return;
    }
    try {
      await saveMcpServer({
        name: name.trim(),
        command: command.trim(),
        args: args.split(/\s+/).filter(Boolean),
        env: parseEnvLines(env),
        url: url.trim(),
        enabled,
      });
      toast('已保存', 'success');
      onSaved();
    } catch (e) {
      toast(String((e as Error)?.message ?? e), 'error');
    }
  };

  const toggle = async () => {
    if (!s) return;
    const next = !enabled;
    setEnabled(next);
    try {
      await toggleMcpServer(s.name, next);
      onSaved();
    } catch (e) {
      toast(String((e as Error)?.message ?? e), 'error');
    }
  };

  return (
    <div
      style={{
        borderRadius: 'var(--radius-inner)',
        padding: '10px 12px', background: 'var(--canvas)', opacity: enabled ? 1 : 0.6,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <input
          value={name}
          placeholder="服务器名"
          onChange={(e) => setName(e.target.value)}
          style={{ ...inputStyle, flex: 1, fontWeight: 600, minWidth: 120 }}
        />
        {s && (
          <span style={{
            fontSize: 11, padding: '2px 8px', borderRadius: 4, flexShrink: 0,
            color: s.connected ? 'var(--success)' : 'var(--text-muted)',
            background: s.connected ? 'var(--success-bg)' : 'var(--hover)',
          }}>
            {s.connected ? `已连接 · ${s.toolCount} 工具` : '未连接'}
          </span>
        )}
        {s && <Toggle on={enabled} onChange={() => void toggle()} />}
        <button onClick={() => void save()} disabled={busy} style={{ ...btnStyle, flexShrink: 0 }}>
          保存
        </button>
        {s && s.connected && (
          <button onClick={onDisconnect} disabled={busy} style={{ ...btnStyle, flexShrink: 0 }}>断开</button>
        )}
        {s && !s.connected && (
          <button onClick={onConnect} disabled={busy} style={{ ...btnStyle, flexShrink: 0 }}>
            {busy ? '连接中…' : '连接'}
          </button>
        )}
        {draft && onCancel && (
          <button onClick={onCancel} style={{ ...btnStyle, flexShrink: 0 }}>取消</button>
        )}
        {s && (
          <button
            onClick={onDelete}
            title="删除服务器"
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
          onChange={(e) => setCommand(e.target.value)}
          style={{ ...inputStyle, flex: 1 }}
        />
        <input
          value={args}
          placeholder="args，空格分隔"
          onChange={(e) => setArgs(e.target.value)}
          style={{ ...inputStyle, flex: 1 }}
        />
      </div>
      <input
        value={url}
        placeholder="远程 URL，可选"
        onChange={(e) => setUrl(e.target.value)}
        style={{ ...inputStyle, marginTop: 8 }}
      />
      <textarea
        value={env}
        placeholder={'环境变量，每行 KEY=VALUE'}
        onChange={(e) => setEnv(e.target.value)}
        rows={3}
        style={{
          ...inputStyle, marginTop: 8, minHeight: 52, resize: 'vertical',
          fontFamily: 'var(--font-mono)', lineHeight: 1.5,
        }}
      />
    </div>
  );
}
