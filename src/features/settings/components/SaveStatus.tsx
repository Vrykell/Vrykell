import type { SaveStatus as Status } from '../hooks/useAutoSave';
import { useEffect, useState } from 'react';
import { useSettingsSave } from './SettingsSaveProvider';
import { t } from '@i18n';

const labels: Record<Status, string> = { idle: '', pending: 'Pending changes…', saving: 'Saving…', saved: 'Saved', error: 'Save failed' };

export default function SaveStatus({ status, error, onRetry, inline = false }: { status: Status; error?: string; onRetry?: () => void; inline?: boolean }) {
  const { report } = useSettingsSave();
  const [confirmed, setConfirmed] = useState(true);
  useEffect(() => {
    setConfirmed(true);
    if (status !== 'saved') return;
    const timer = setTimeout(() => setConfirmed(false), 1800);
    return () => clearTimeout(timer);
  }, [status]);
  if (status === 'idle' || (status === 'saved' && !confirmed) || (inline && report && status !== 'error')) return null;
  return <span role="status" aria-live="polite" style={{ display: 'inline-flex', alignItems: 'center', gap: 6,
    fontSize: 'var(--fs-micro)', color: status === 'error' ? 'var(--error-light)' : 'var(--text-muted)' }}>
    {status === 'error' ? error || t(labels.error) : t(labels[status])}
    {status === 'error' && onRetry && <button type="button" data-subtle onClick={onRetry}
      style={{ border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer', font: 'inherit', padding: '2px 4px' }}>{t('Retry')}</button>}
  </span>;
}
