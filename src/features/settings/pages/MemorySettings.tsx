import { useEffect, useRef, useState } from 'react';
import { t } from '@i18n';
import { memoryStats, type MemoryStats } from '@features/agent/services/platform';
import { OutlineButton } from '@ui/actions/OutlineButton';
import ErrorBox from '@ui/feedback/ErrorBox';
import { Field, SettingsGroup } from '../components/ui';
import ReloadButton from '@ui/actions/ReloadButton';
import { Sparkles } from '@ui/icons';
import { organizeMemoryWithAssistant } from '@features/workspace/services/workspaceActions';

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
  return <SettingsGroup title={t('Agent memory')}>
    <Field title={t('Memory retrieval')} description={<span aria-busy={loading}>{loading && !stats ? <span role="status">{t('Loading…')}</span> : stats ? <>{t('Total memories')}: <span data-testid="memory-count-total">{stats.total}</span> · {t('Active')}: <span data-testid="memory-count-active">{stats.active}</span> · {t('Needs review')}: <span data-testid="memory-count-pending">{stats.pending}</span></> : t('Could not load memory status')}</span>}>
      <ReloadButton compact label={t('Reload')} busy={loading} onReload={reload} />
    </Field>
    <Field title={t('Review memories')} description={t('Review pending and expired memories, combine duplicates, and check outdated facts with the assistant.')}>
      <OutlineButton onClick={organizeMemoryWithAssistant}><Sparkles size={16} />{t('Organize with AI')}</OutlineButton>
    </Field>
    {error && <ErrorBox title={t('Could not load memory status')} details={error} onDismiss={() => setError(null)} actions={<OutlineButton onClick={reload}>{t('Retry')}</OutlineButton>} />}
  </SettingsGroup>;
}
