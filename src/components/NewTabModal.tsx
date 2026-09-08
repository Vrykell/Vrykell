import { Search, Server, Terminal } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getAvailableShells, type ShellOption } from '@/services/tauri/shells';
import {
  buildNewTabOptions,
  filterNewTabOptions,
  type NewTabOption,
  touchRecentOpen,
} from '@/services/tauri/tabTypes';
import type { TerminalSpec } from '@/services/tauri/windowLayout';
import { cx } from '@/shared/utils/cx';
import { ensureSshLoaded, useSshStore } from '@/ssh/store';
import { useWorkspaceStore } from '@/store/workspace';
import s from './NewTabModal.module.css';

interface Props {
  open: boolean;
  onClose: () => void;
  groupId?: string;
  onPick?: (spec: TerminalSpec) => void;
}

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
    getAvailableShells().then((sh) => {
      if (!cancelled) setShells(sh);
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
  const filtered = useMemo(() => filterNewTabOptions(options, query), [options, query]);

  useEffect(() => setSelected(0), [query]);

  const create = useCallback(
    (opt: NewTabOption) => {
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
              id: '',
              kind: 'ssh',
              ssh: {
                name: conn.name,
                host: conn.host,
                user: conn.user,
                port: conn.port,
                connectionId: conn.id,
              },
            });
            onClose();
            return;
          }
          useWorkspaceStore.getState().addTab({
            kind: 'ssh',
            ssh: {
              name: conn.name,
              host: conn.host,
              user: conn.user,
              port: conn.port,
              connectionId: conn.id,
            },
            groupId,
          });
        }
      }
      onClose();
    },
    [onClose, groupId, onPick],
  );

  const handleKey = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelected((s) => Math.min(s + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelected((s) => Math.max(s - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const o = filtered[selected];
        if (o) create(o);
      }
    },
    [filtered, selected, create, onClose],
  );

  if (!open) return null;

  return (
    <div className={s.overlay} onClick={onClose}>
      <div className={s.panel} onClick={(e) => e.stopPropagation()} onKeyDown={handleKey}>
        <div className={s.title}>新建标签页</div>
        <div className={s.searchBox}>
          <div className={s.searchInner}>
            <Search size={13} className={s.searchIcon} />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索标签页类型…"
              className={s.searchInput}
            />
          </div>
        </div>
        <div className={s.list}>
          {filtered.length === 0 ? (
            <div className={s.empty}>无匹配类型</div>
          ) : (
            filtered.map((o, i) => (
              <OptionRow
                key={o.key}
                opt={o}
                selected={i === selected}
                onSelect={() => setSelected(i)}
                onCreate={() => create(o)}
              />
            ))
          )}
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
      className={cx(s.option, selected && s.optionSelected)}
    >
      <span className={s.optionIcon}>
        <Icon size={13} />
      </span>
      <span className={s.optionLabel}>
        <span className={s.optionName}>{opt.label}</span>
        {opt.subtitle && <span className={s.optionSubtitle}>{opt.subtitle}</span>}
      </span>
    </button>
  );
}
