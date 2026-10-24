export default function Toggle({ on, onChange, label, compact = false, disabled = false }: { on: boolean; onChange: (value: boolean) => void; label?: string; compact?: boolean; disabled?: boolean }) {
  return <button type="button" data-subtle role="switch" disabled={disabled} aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
    style={{ width: compact ? 32 : 38, height: compact ? 18 : 22, borderRadius: 10, border: 'none', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? .5 : 1, background: on ? 'var(--primary-button-bg)' : 'var(--hover)', position: 'relative', flexShrink: 0 }}>
    <span style={{ position: 'absolute', top: compact ? 2 : 3, left: compact ? on ? 16 : 2 : on ? 19 : 3, width: compact ? 14 : 16, height: compact ? 14 : 16, borderRadius: '50%', transition: 'left 0.16s var(--ease)', background: on ? 'var(--primary-button-text)' : 'var(--text-muted)' }} />
  </button>;
}
