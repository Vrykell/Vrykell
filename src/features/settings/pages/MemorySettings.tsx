import { useEffect, useRef, useState } from 'react';
import { t } from '@i18n';
import { memoryStats, type MemoryStats } from '@features/agent/services/platform';
import { OutlineButton } from '@ui/actions/OutlineButton';
import ErrorBox from '@ui/feedback/ErrorBox';
import { Field, SettingsGroup } from '../components/ui';

export function MemorySettings() {
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const reload = () => { setError(null); setRevision(value => value + 1); };
  useEffect(() => {
    const request = ++generation.current;
    setLoading(true);
    void memoryStats().then(next => { if (request === generation.current) setStats(next); })
      .catch((failure: unknown) => { if (request === generation.current) setError(String(failure)); })
      .finally(() => { if (request === generation.current) setLoading(false); });
    return () => { generation.current++; };
  }, [revision]);
  const labels = [['total', 'Total memories'], ['active', 'Active'], ['pending', 'Needs review'], ['expired', 'Expired'], ['inactive', 'Inactive']] as const;
  return <SettingsGroup title={t('Agent memory')}>
    <Field title={t('Memory retrieval')} description={t('Only relevant, active and unexpired facts are recalled. Old files are preserved and imported for review; they are never automatically injected.')} layout="stacked">
      <p className="settings-description">{t('Local full-text retrieval. No extra service or model download. Facts expire after 90 days by default; review and renew them when needed.')}</p>
      <p className="settings-description">{t('Memory content is managed through the assistant on request. This page only shows status; reviewing or changing a fact requires an explicit memory operation.')}</p>
      <div aria-busy={loading} style={{ minHeight: 96 }}>
        {loading ? <p role="status">{t('Loading…')}</p> : stats ? <dl style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 24px', margin: '12px 0' }}>
          {labels.map(([key, label]) => <div key={key}><dt className="settings-description">{t(label)}</dt><dd data-testid={`memory-count-${key}`} style={{ margin: '4px 0', fontVariantNumeric: 'tabular-nums' }}>{stats[key]}</dd></div>)}
        </dl> : null}
      </div>
      <OutlineButton onClick={() => { if (!loading) reload(); }} disabled={loading && !stats} aria-disabled={loading} aria-busy={loading}>{t('Reload')}</OutlineButton>
    </Field>
    {error && <ErrorBox title={t('Could not load memory status')} details={error} onDismiss={() => setError(null)} actions={<OutlineButton onClick={reload}>{t('Retry')}</OutlineButton>} />}
  </SettingsGroup>;
}
