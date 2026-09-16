/**
 * ui — 设置页共享样式与基础控件（Field/Toggle/输入/数字/模板列表）。
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Plus, X } from 'lucide-react';

// ── 通用样式 ──

export const inputStyle: React.CSSProperties = {
  background: 'var(--canvas)', border: '1px solid var(--border)',
  borderRadius: 'var(--radius-inner)', padding: '6px 8px', fontSize: 12,
  color: 'var(--text-primary)', outline: 'none', width: '100%',
  fontFamily: 'var(--font-mono)', boxSizing: 'border-box',
};

export const btnStyle: React.CSSProperties = {
  padding: '5px 12px', fontSize: 12, border: '1px solid var(--border)',
  borderRadius: 'var(--radius-inner)', background: 'transparent',
  color: 'var(--text-secondary)', cursor: 'pointer',
};

export function Field({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2, letterSpacing: '0.01em' }}>{title}</div>
      {description && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 10 }}>{description}</div>
      )}
      <div style={{ marginTop: description ? 0 : 8 }}>{children}</div>
    </div>
  );
}

// ── 开关（AI 行为页用） ──

export function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      data-subtle
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      style={{
        width: 34, height: 19, borderRadius: 10, border: 'none', cursor: 'pointer',
        background: on ? 'var(--accent)' : 'var(--hover)', position: 'relative', flexShrink: 0,
      }}
    >
      <span
        style={{
          position: 'absolute', top: 2, left: on ? 17 : 2, width: 15, height: 15,
          borderRadius: '50%', transition: 'left 0.16s var(--ease)',
          background: on ? 'var(--accent-text)' : 'var(--text-muted)',
        }}
      />
    </button>
  );
}

export function ModelTextInput({ value, onCommit, placeholder, style }: {
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  style?: React.CSSProperties;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { const v = draft.trim(); if (v !== value) onCommit(v); }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      style={{ ...inputStyle, ...style }}
    />
  );
}

export function NumberInput({ value, onChange, min, max }: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      onChange={(e) => {
        const n = Math.round(Number(e.target.value));
        if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
      }}
      style={{ ...inputStyle, width: 120 }}
    />
  );
}
export function TemplateListEditor({ value, onChange, placeholder }: {
  value: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
  placeholder: string;
}) {
  const [rows, setRows] = useState<{ ext: string; cmd: string }[]>(() =>
    Object.entries(value).map(([ext, cmd]) => ({ ext, cmd })),
  );

  const sync = (next: { ext: string; cmd: string }[]) => {
    setRows(next);
    const obj: Record<string, string> = {};
    for (const r of next) {
      const e = r.ext.trim().toLowerCase().replace(/^\./, '');
      const c = r.cmd.trim();
      if (e && c) obj[e] = c;
    }
    onChange(obj);
  };

  const updateRow = (i: number, patch: Partial<{ ext: string; cmd: string }>) => {
    sync(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  };

  return (
    <div>
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
          <input
            value={r.ext}
            placeholder="扩展名，如 md"
            onChange={(e) => updateRow(i, { ext: e.target.value })}
            style={{ ...inputStyle, width: 120, flexShrink: 0 }}
          />
          <input
            value={r.cmd}
            placeholder={placeholder}
            onChange={(e) => updateRow(i, { cmd: e.target.value })}
            style={{ ...inputStyle, flex: 1 }}
          />
          <button
            onClick={() => sync(rows.filter((_, j) => j !== i))}
            title="删除此行"
            style={{
              width: 26, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              border: '1px solid transparent', borderRadius: 4, background: 'transparent',
              color: 'var(--text-muted)', cursor: 'pointer',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--error-light)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
          >
            <X size={13} />
          </button>
        </div>
      ))}
      <button
        onClick={() => sync([...rows, { ext: '', cmd: '' }])}
        style={{ ...btnStyle, display: 'inline-flex', alignItems: 'center', gap: 4 }}
      >
        <Plus size={12} /> 添加
      </button>
    </div>
  );
}
