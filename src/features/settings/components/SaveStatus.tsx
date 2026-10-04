import type { SaveStatus as Status } from '../hooks/useAutoSave';

const labels: Record<Status, string> = { idle: '自动保存', pending: '待保存…', saving: '保存中…', saved: '已保存', error: '保存失败' };

export default function SaveStatus({ status, error, onRetry }: { status: Status; error?: string; onRetry?: () => void }) {
  return <span role="status" aria-live="polite" style={{ display: 'inline-flex', alignItems: 'center', gap: 6,
    fontSize: 'var(--fs-micro)', color: status === 'error' ? 'var(--error-light)' : 'var(--text-muted)' }}>
    {status === 'error' ? error || labels.error : labels[status]}
    {status === 'error' && onRetry && <button type="button" data-subtle onClick={onRetry}
      style={{ border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer', font: 'inherit', padding: '2px 4px' }}>重试</button>}
  </span>;
}
