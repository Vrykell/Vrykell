import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { getCommands } from '@app/commands';

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
    () => query
      ? allCommands.filter((c) =>
          c.label.toLowerCase().includes(query.toLowerCase()) ||
          c.desc.toLowerCase().includes(query.toLowerCase()))
      : allCommands,
    [query, allCommands],
  );

  useEffect(() => {
    if (open) { setQuery(''); setSelected(0); requestAnimationFrame(() => inputRef.current?.focus()); }
  }, [open]);

  const handleKey = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setSelected((s) => Math.min(s + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSelected((s) => Math.max(s - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); const cmd = filtered[selected]; if (cmd) { cmd.action(); onClose(); } }
  }, [filtered, selected, onClose]);

  if (!open) return null;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9995, display: 'flex', justifyContent: 'center', paddingTop: '15vh', background: 'var(--overlay)', animation: 'overlayIn 0.18s var(--ease)' }} onClick={onClose}>
      <div className="workspace-floating workspace-floating-dialog" role="dialog" aria-modal="true" aria-label="命令面板" style={{ width: 520, maxWidth: 'calc(100vw - 40px)', maxHeight: '55vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', animation: 'modalIn 0.22s var(--ease-out)' }} onClick={(e) => e.stopPropagation()} onKeyDown={handleKey}>
        <div style={{ padding: '8px 10px', margin: 10, borderRadius: 'var(--radius-inner)', background: 'var(--canvas)' }}>
          <input ref={inputRef} value={query} onChange={(e) => { setQuery(e.target.value); setSelected(0); }}
            placeholder="搜索命令…" style={{ width: '100%', background: 'transparent', border: 'none', height: 28, padding: 0, fontSize: 'calc(13px * var(--ui-font-scale))', fontWeight: 500, color: 'var(--text-primary)', outline: 'none', fontFamily: 'var(--font-ui)' }} />
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px 8px' }}>
          {filtered.length === 0 ? (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 'calc(13px * var(--ui-font-scale))' }}>无匹配命令</div>
          ) : filtered.map((cmd, i) => (
            <button className="workspace-floating-row" key={cmd.id} onClick={() => { cmd.action(); onClose(); }}
              onMouseEnter={() => setSelected(i)}
              style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', padding: '9px 16px', border: 'none', background: i === selected ? 'var(--hover)' : 'transparent', color: 'var(--text-primary)', cursor: 'pointer', fontSize: 'calc(13px * var(--ui-font-scale))', fontWeight: 500, transition: 'background var(--dur) var(--ease)' }}>
              <span style={{ flex: 1 }}>{cmd.label}</span>
              <span style={{ color: 'var(--text-muted)', fontSize: 'calc(11.5px * var(--ui-font-scale))' }}>{cmd.desc}</span>
              {cmd.keys && <span style={{ color: 'var(--text-secondary)', fontSize: 'calc(10.5px * var(--ui-font-scale))', fontFamily: 'var(--font-mono)', background: 'var(--canvas)', padding: '1px 6px', borderRadius: 4, border: '1px solid var(--border)' }}>{cmd.keys}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
