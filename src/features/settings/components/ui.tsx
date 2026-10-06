/**
 * Shared settings fields, controls and form styles.
 */
import { useState, type ReactNode } from 'react';
import { iconSizes, Plus, X  } from '@ui/icons';
import AutoSaveInput from './AutoSaveInput';
import { useAutoSave } from '../hooks/useAutoSave';
import SaveStatus from './SaveStatus';
import { useSettingsSave } from './SettingsSaveProvider';
import { inputStyle, btnStyle } from './formStyles';
export { inputStyle, btnStyle } from './formStyles';

export function Field({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <div className="settings-field">
      <div style={{ fontSize: 'calc(13px * var(--ui-font-scale))', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2, letterSpacing: '0.01em' }}>{title}</div>
      {description && (
        <div style={{ fontSize: 'calc(11px * var(--ui-font-scale))', color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 10 }}>{description}</div>
      )}
      <div style={{ marginTop: description ? 0 : 8 }}>{children}</div>
    </div>
  );
}

// ── 开关（AI 行为页用） ──

export function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void | Promise<void> }) {
  const { save } = useSettingsSave();
  return (
    <span className="settings-toggle"><button
      data-subtle
      role="switch"
      aria-checked={on}
      onClick={() => { void save(() => onChange(!on)); }}
      style={{
        width: 38, height: 22, borderRadius: 10, border: 'none', cursor: 'pointer',
        background: on ? 'var(--accent)' : 'var(--hover)', position: 'relative', flexShrink: 0,
      }}
    >
      <span
        style={{
          position: 'absolute', top: 3, left: on ? 19 : 3, width: 16, height: 16,
          borderRadius: '50%', transition: 'left 0.16s var(--ease)',
          background: on ? 'var(--accent-text)' : 'var(--text-muted)',
        }}
      />
    </button><span aria-hidden="true">{on ? '已开启' : '已关闭'}</span></span>
  );
}

export function ModelTextInput({ value, onCommit, placeholder, style }: {
  value: string;
  onCommit: (v: string) => void | Promise<void>;
  placeholder?: string;
  style?: React.CSSProperties;
}) {
  return <AutoSaveInput value={value} onCommit={onCommit} placeholder={placeholder} style={style} />;
}

export function NumberInput({ value, onChange, min, max }: {
  value: number;
  onChange: (v: number) => void | Promise<void>;
  min: number;
  max: number;
}) {
  return (
    <AutoSaveInput
      type="number"
      value={String(value)}
      min={min}
      max={max}
      normalize={next => String(Math.min(max, Math.max(min, Math.round(Number(next)))))}
      onCommit={next => {
        const n = Math.round(Number(next));
        if (Number.isFinite(n)) return onChange(Math.min(max, Math.max(min, n)));
      }}
      validate={next => next.trim() && Number.isFinite(Number(next)) ? undefined : '请输入有效数字'}
      style={{ width: 120 }}
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

  const saving = useAutoSave(value, onChange);
  const sync = (next: { ext: string; cmd: string }[], immediate = false) => {
    setRows(next);
    const obj: Record<string, string> = {};
    for (const r of next) {
      const e = r.ext.trim().toLowerCase().replace(/^\./, '');
      const c = r.cmd.trim();
      if (e && c) obj[e] = c;
    }
    saving.setValue(obj, immediate);
  };

  const updateRow = (i: number, patch: Partial<{ ext: string; cmd: string }>) => {
    sync(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  };

  return (
    <div onCompositionStart={() => saving.setComposing(true)} onCompositionEnd={() => saving.setComposing(false)}>
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
            onClick={() => sync(rows.filter((_, j) => j !== i), true)}
            data-tip="删除此行"
            aria-label="删除此行"
            style={{
              width: 26, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              border: '1px solid transparent', borderRadius: 4, background: 'transparent',
              color: 'var(--text-muted)', cursor: 'pointer',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--error-light)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
          >
            <X size={iconSizes.compact} />
          </button>
        </div>
      ))}
      <button
        onClick={() => sync([...rows, { ext: '', cmd: '' }])}
        style={{ ...btnStyle, display: 'inline-flex', alignItems: 'center', gap: 4 }}
      >
        <Plus size={iconSizes.compact} /> 添加
      </button>
      <div><SaveStatus status={saving.status} error={saving.error} onRetry={() => { void saving.flush(); }} /></div>
    </div>
  );
}
