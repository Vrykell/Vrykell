import { useEffect, useRef, useState } from 'react';
import { t } from '@i18n';
import { memoryStats, type MemoryStats } from '@features/agent/services/platform';
import { OutlineButton } from '@ui/actions/OutlineButton';
import ErrorBox from '@ui/feedback/ErrorBox';
import { organizeMemoryWithAssistant } from '@features/workspace/services/workspaceActions';
import './resources.css';

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
  return <div className="memory-overview">
    <p className="memory-intro">{t('Relevant memories are available to the assistant during conversations.')}</p>
    <div className="memory-status" aria-busy={loading}>
      <div className="resource-detail-header">
        <div className="resource-identity"><strong>{t('Memory retrieval')}</strong>
          {stats ? <div className="memory-counts">{([
            ['total', 'Total memories', stats.total], ['active', 'Active', stats.active], ['pending', 'Needs review', stats.pending],
          ] as const).map(([key, label, value]) => <span key={key}>{t(label)} <span data-testid={`memory-count-${key}`}>{value}</span></span>)}</div>
            : <p role="status">{t(loading ? 'Loading…' : 'Could not load memory status')}</p>}
        </div>
        <OutlineButton disabled={loading} aria-busy={loading} onClick={reload}>{t('Reload')}</OutlineButton>
      </div>
    <div className="memory-review resource-setting-row">
      <div className="resource-identity"><strong>{t('Review memories')}</strong><p>{t('Review pending and expired memories, combine duplicates, and check outdated facts with the assistant.')}</p></div>
      <OutlineButton onClick={organizeMemoryWithAssistant}>{t('Organize with AI')}</OutlineButton>
    </div>
    </div>
    {error && <ErrorBox title={t('Could not load memory status')} details={error} onDismiss={() => setError(null)} actions={<OutlineButton onClick={reload}>{t('Retry')}</OutlineButton>} />}
  </div>;
}
