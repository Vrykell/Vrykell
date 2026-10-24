export function ProgressBar({ value, label }: { value: number; label: string }) {
  const percent = Math.min(100, Math.max(0, value));
  return <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}
    style={{ height: 4, width: '100%', overflow: 'hidden', borderRadius: 2, background: 'var(--hover)' }}>
    <div style={{ height: '100%', width: `${percent}%`, background: 'var(--progress-color, var(--xterm-blue))', transition: 'width 160ms var(--ease)' }} />
  </div>;
}
