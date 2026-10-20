import { OutlineButton } from '@ui/OutlineButton';
import { t, localizeLabel } from '@i18n';
import { IconButton } from '@ui/IconButton';
import { useSettingsNavigationStore } from '../stores/navigation';
import { TextInput } from '@ui/TextInput';
/**
 * Shared settings fields, controls and form styles.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { iconSizes, Plus, X  } from '@ui/icons';
import AutoSaveInput from './AutoSaveInput';
import { useAutoSave } from '../hooks/useAutoSave';
import SaveStatus from './SaveStatus';
import { useSettingsSave } from './SettingsSaveProvider';
import { inputStyle } from './formStyles';
export { inputStyle } from './formStyles';

export function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return <div className="settings-group" role="group" aria-labelledby={id}>
    <h2 id={id} className="settings-group-title">{localizeLabel(title)}</h2>
    <div className="settings-group-panel">{children}</div>
  </div>;
}

export function Field({ title, description, children, layout = 'row' }: {
  title: string; description?: ReactNode; children: ReactNode; layout?: 'row' | 'stacked';
}) {
  const ref = useRef<HTMLDivElement>(null);
  const target = useSettingsNavigationStore(state => state.targetField);
  const control = useSettingsNavigationStore(state => state.targetControl);
  const request = useSettingsNavigationStore(state => state.request);
  useEffect(() => {
    if (target !== title) return;
    ref.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    const controls = [...(ref.current?.querySelectorAll<HTMLElement>('input, textarea, button, [tabindex="0"]') ?? [])];
    (controls.find(element => control && element.getAttribute('aria-label') === control) ?? controls[0])?.focus({ preventScroll: true });
  }, [target, title, control, request]);
  return (
    <div ref={ref} className="settings-field" data-setting-title={title} data-layout={layout}>
      <div className="settings-field-title">{localizeLabel(title)}</div>
      {description && (
        <div className="settings-description">{typeof description === 'string' ? localizeLabel(description) : description}</div>
      )}
      <div className="settings-field-control">{children}</div>
    </div>
  );
}

// ── 开关（AI 行为页用） ──

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void | Promise<void>; label?: string }) {
  const { save } = useSettingsSave();
  return (
    <span className="settings-toggle"><button
      data-subtle
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => { void save(() => onChange(!on)); }}
      style={{
        width: 38, height: 22, borderRadius: 10, border: 'none', cursor: 'pointer',
        background: on ? 'var(--primary-button-bg)' : 'var(--hover)', position: 'relative', flexShrink: 0,
      }}
    >
      <span
        style={{
          position: 'absolute', top: 3, left: on ? 19 : 3, width: 16, height: 16,
          borderRadius: '50%', transition: 'left 0.16s var(--ease)',
          background: on ? 'var(--primary-button-text)' : 'var(--text-muted)',
        }}
      />
    </button><span aria-hidden="true">{t(on ? 'On' : 'Off')}</span></span>
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
          <TextInput
            value={r.ext}
            placeholder="扩展名，如 md"
            onChange={(e) => updateRow(i, { ext: e.target.value })}
            style={{ ...inputStyle, width: 120, flexShrink: 0 }}
          />
          <TextInput
            value={r.cmd}
            placeholder={placeholder}
            onChange={(e) => updateRow(i, { cmd: e.target.value })}
            style={{ ...inputStyle, flex: 1 }}
          />
          <IconButton compact tone="danger" onClick={() => sync(rows.filter((_, j) => j !== i), true)} data-tip={t('Delete row')} aria-label={t('Delete row')}><X size={iconSizes.compact} /></IconButton>
        </div>
      ))}
      <OutlineButton
        onClick={() => sync([...rows, { ext: '', cmd: '' }])}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
      >
        <Plus size={iconSizes.compact} /> 添加
      </OutlineButton>
      <div><SaveStatus inline status={saving.status} error={saving.error} onRetry={() => { void saving.flush(); }} /></div>
    </div>
  );
}
