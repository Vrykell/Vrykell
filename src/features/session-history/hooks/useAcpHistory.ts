import { useCallback, useEffect, useRef, useState } from 'react';
import type { AcpTranscriptSummary } from '@platform/api/acp';
import { listHarnessTranscripts } from '@features/chat/services/harnessTranscripts';

/** Metadata of locally retained ACP transcripts; message bodies stay out of the list path. */
export function useAcpHistory() {
  const [summaries, setSummaries] = useState<AcpTranscriptSummary[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);
  const reload = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true);
    try {
      const next = await listHarnessTranscripts();
      if (request !== generation.current) return;
      setSummaries(next);
      setError('');
    } catch (reason) {
      if (request === generation.current) setError(String(reason));
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void reload();
    return () => { generation.current += 1; };
  }, [reload]);
  return { summaries, error, loading, reload };
}
