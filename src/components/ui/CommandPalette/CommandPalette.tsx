import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getCommands } from '@/shared/constants/commands';
import { cx } from '@/shared/utils/cx';
import s from './CommandPalette.module.css';

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function CommandPalette({ open, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const allCommands = useMemo(() => getCommands(), []);

  const filtered = useMemo(
    () =>
      query
        ? allCommands.filter(
            (c) =>
              c.label.toLowerCase().includes(query.toLowerCase()) ||
              c.desc.toLowerCase().includes(query.toLowerCase()),
          )
        : allCommands,
    [query, allCommands],
  );

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelected(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const handleKey = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelected((s) => Math.min(s + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelected((s) => Math.max(s - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const cmd = filtered[selected];
        if (cmd) {
          cmd.action();
          onClose();
        }
      }
    },
    [filtered, selected, onClose],
  );

  if (!open) return null;

  return (
    <div className={s.overlay} onClick={onClose}>
      <div className={s.panel} onClick={(e) => e.stopPropagation()} onKeyDown={handleKey}>
        <div className={s.searchBox}>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(0);
            }}
            placeholder="搜索命令…"
            className={s.searchInput}
          />
        </div>
        <div className={s.list}>
          {filtered.length === 0 ? (
            <div className={s.empty}>无匹配命令</div>
          ) : (
            filtered.map((cmd, i) => (
              <button
                key={cmd.id}
                onClick={() => {
                  cmd.action();
                  onClose();
                }}
                onMouseEnter={() => setSelected(i)}
                data-selected={i === selected ? '' : undefined}
                className={cx(s.item, i === selected && s.itemSelected)}
              >
                <span className={s.label}>{cmd.label}</span>
                <span className={s.desc}>{cmd.desc}</span>
                {cmd.keys && <span className={s.keys}>{cmd.keys}</span>}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
