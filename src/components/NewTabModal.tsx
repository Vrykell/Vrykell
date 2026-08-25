import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Search, Server, Terminal } from 'lucide-react';
import { getAvailableShells, type ShellOption } from '../lib/shells';
import {
  buildNewTabOptions,
  filterNewTabOptions,
  touchRecentOpen,
  type NewTabOption,
} from '../lib/tabTypes';
import { useSshStore, ensureSshLoaded } from '../ssh/store';
import { useWorkspaceStore } from '../stores/workspace';
import type { TerminalSpec } from '../lib/windowLayout';

interface Props {
  open: boolean;
  onClose: () => void;
  /** 新建标签归属的分组 id（undefined=未分组） */
  groupId?: string;
  /** 提供时：选择后不新建标签，而是回调所选终端 spec（分裂/替换终端用） */
  onPick?: (spec: TerminalSpec) => void;
}

/**
 * NewTabModal — 新建标签页 / 选择终端类型的弹窗（屏幕居中）。
 * 候选 = 机器可用 shell + 已配置 SSH 连接，按最近打开时间倒序，顶部搜索框过滤。
 */
export default function NewTabModal({ open, onClose, groupId, onPick }: Props) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const [shells, setShells] = useState<ShellOption[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const sshConnections = useSshStore((s) => s.connections);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setSelected(0);
    ensureSshLoaded();
    let cancelled = false;
    getAvailableShells().then((s) => {
      if (!cancelled) setShells(s);
    });
    requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      cancelled = true;
    };
  }, [open]);

  const options = useMemo(
    () => buildNewTabOptions(shells, sshConnections),
    [shells, sshConnections],
  );

  const filtered = useMemo(
    () => filterNewTabOptions(options, query),
    [options, query],
  );

  useEffect(() => setSelected(0), [query]);

  const create = useCallback((opt: NewTabOption) => {
    if (opt.kind === 'shell') {
      touchRecentOpen(opt.key);
      if (onPick) {
        onPick({ id: '', kind: 'local', shellType: opt.shellType });
        onClose();
        return;
      }
      useWorkspaceStore.getState().addTab({ shellType: opt.shellType, groupId });
    } else {
      touchRecentOpen(opt.key);
      void useSshStore.getState().touch(opt.sshId);
      const conn = useSshStore.getState().connections.find((c) => c.id === opt.sshId);
      if (conn) {
        if (onPick) {
          onPick({
            id: '', kind: 'ssh',
            ssh: { name: conn.name, host: conn.host, user: conn.user, port: conn.port, connectionId: conn.id },
          });
          onClose();
          return;
        }
        useWorkspaceStore.getState().addTab({
          kind: 'ssh',
          ssh: { name: conn.name, host: conn.host, user: conn.user, port: conn.port, connectionId: conn.id },
          groupId,
        });
      }
    }
    onClose();
  }, [onClose, groupId, onPick]);

  const handleKey = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
    else if (e.key === 'ArrowDown') { e.preventDefault(); setSelected((s) => Math.min(s + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSelected((s) => Math.max(s - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); const o = filtered[selected]; if (o) create(o); }
  }, [filtered, selected, create, onClose]);

  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9996,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--overlay)',
        animation: 'overlayIn 0.18s var(--ease)',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: 420, maxHeight: '70vh',
          background: 'var(--elevated)', border: '1px solid var(--border-strong)',
          borderRadius: 'var(--radius-block)', boxShadow: 'var(--shadow-lg)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          animation: 'modalIn 0.22s var(--ease-out)',
        }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKey}
      >
        <div style={{
          padding: '12px 16px 4px', fontSize: 13, fontWeight: 600,
          color: 'var(--text-primary)',
        }}>
          新建标签页
        </div>

        {/* 搜索框 */}
        <div style={{ padding: '8px 16px' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'var(--canvas)',
            borderRadius: 'var(--radius-inner)', padding: '0 8px', height: 28,
          }}>
            <Search size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索标签页类型…"
              style={{
                flex: 1, background: 'transparent', border: 'none', outline: 'none',
                fontSize: 13, color: 'var(--text-primary)', fontFamily: 'var(--font-ui)',
              }}
            />
          </div>
        </div>

        {/* 候选列表 */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 8px 10px' }}>
          {filtered.length === 0 ? (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
              无匹配类型
            </div>
          ) : filtered.map((o, i) => (
            <OptionRow
              key={o.key}
              opt={o}
              selected={i === selected}
              onSelect={() => setSelected(i)}
              onCreate={() => create(o)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function OptionRow({
  opt,
  selected,
  onSelect,
  onCreate,
}: {
  opt: NewTabOption;
  selected: boolean;
  onSelect: () => void;
  onCreate: () => void;
}) {
  const Icon = opt.kind === 'ssh' ? Server : Terminal;
  return (
    <button
      onClick={onCreate}
      onMouseEnter={onSelect}
      data-testid={`new-tab-option-${opt.key}`}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        width: '100%', textAlign: 'left', padding: '8px 10px',
        border: 'none', borderRadius: 'var(--radius-inner)',
        background: selected ? 'var(--hover)' : 'transparent',
        color: 'var(--text-primary)', cursor: 'pointer', fontSize: 13,
      }}
    >
      <span style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 24, height: 24, borderRadius: 5,
        background: 'var(--canvas)', color: 'var(--text-secondary)', flexShrink: 0,
      }}>
        <Icon size={13} />
      </span>
      <span style={{ flex: 1, overflow: 'hidden' }}>
        <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {opt.label}
        </span>
        {opt.subtitle && (
          <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {opt.subtitle}
          </span>
        )}
      </span>
    </button>
  );
}
