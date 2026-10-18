import { useCallback, useEffect, useState } from 'react';
import type { GitSnapshot, GitTarget } from '@core/git';
import { getGitSnapshot } from '@platform/api/git';

export function useGitRepository(target: GitTarget | null, visible: boolean) {
  const cwd = target?.cwd;
  const connectionId = target?.connectionId;
  const key = JSON.stringify([cwd, connectionId]);
  const [state, setState] = useState<{ key: string; snapshot: GitSnapshot | null; error: string; loading: boolean }>();
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    if (!visible || !cwd) return;
    let disposed = false;
    let busy = false;
    const load = async () => {
      if (busy || document.hidden) return;
      busy = true;
      setState(previous => ({ key, snapshot: previous?.key === key ? previous.snapshot : null, error: '', loading: true }));
      try {
        const snapshot = await getGitSnapshot({ cwd, connectionId });
        if (!disposed) setState({ key, snapshot, error: '', loading: false });
      } catch (reason) {
        if (!disposed) setState({ key, snapshot: null, error: reason instanceof Error ? reason.message : String(reason), loading: false });
      } finally { busy = false; }
    };
    void load();
    const timer = window.setInterval(() => { void load(); }, 5000);
    const onFocus = () => { void load(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      disposed = true;
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [cwd, connectionId, key, visible, revision]);
  const current = state?.key === key ? state : undefined;
  return { snapshot: current?.snapshot ?? null, error: current?.error ?? '', loading: !!cwd && visible && (current?.loading ?? true), refresh };
}
