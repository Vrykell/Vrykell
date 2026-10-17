import { useEffect, useState } from 'react';
import { commandEnvironment } from '@core/commandHistory';
import { getCommandContext, getProjectRootOverride, saveProjectRootOverride } from '@platform/api/commandHistory';
import { useActiveWorkspace } from '@features/workspace/hooks/useActiveWorkspace';
import { useDockStore } from '@features/workspace';
import { t } from '@i18n';
import { isWithin, normalizeCommandPath } from '../model/commands';
import type { ExecutionContext } from '../services/execution';

export function useProjectScope() {
  const active = useActiveWorkspace();
  const visible = useDockStore(state => [...state.leftPanels, ...state.rightPanels].includes('command-history'));
  const environment = active.focusedSpec ? commandEnvironment(active.focusedSpec) : null;
  const target = environment?.target ?? '';
  const cwd = active.activeCwd ?? '';
  const key = JSON.stringify([target, cwd]);
  const [resolved, setResolved] = useState<{ key: string; root: string } | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const connectionId = active.focusedSpec?.ssh?.connectionId;
  useEffect(() => {
    if (!visible || !target || !cwd) return;
    let canceled = false;
    setError('');
    void (async () => {
      if (target !== 'local' && !connectionId) throw new Error(t('Save this SSH connection before opening command history.'));
      const override = await getProjectRootOverride(target);
      const root = override?.roots?.filter(root => isWithin(cwd, root)).sort((a, b) => b.length - a.length)[0] ?? null;
      const context = await getCommandContext(cwd, root, connectionId);
      if (!canceled) setResolved({ key, root: context.root });
    })().catch(reason => { if (!canceled) setError(String(reason)); });
    return () => { canceled = true; };
  }, [target, cwd, connectionId, key, visible, attempt]);
  const context: ExecutionContext | null = resolved?.key === key && active.focusedSpec ? {
    target, cwd, root: resolved.root, spec: active.focusedSpec, paneId: active.focusedPaneId,
    scope: JSON.stringify([target, normalizeCommandPath(resolved.root)]),
  } : null;
  const chooseRoot = async (root: string) => {
    if (!isWithin(cwd, root)) throw new Error(t('The project root must contain the terminal directory.'));
    const context = await getCommandContext(cwd, root, connectionId);
    await saveProjectRootOverride(target, context.root);
    setResolved({ key, root: context.root });
    setError('');
  };
  return { context, error, visible, available: !!target && !!cwd, cwd, chooseRoot, kind: active.focusedSpec?.kind, retry: () => setAttempt(value => value + 1) };
}
