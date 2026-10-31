import { useEffect, useState } from 'react';
import { commandEnvironment } from '@core/commandHistory';
import { getCommandContext, getProjectRootOverride, saveProjectRootOverride } from '@platform/api/commandHistory';
import { useDockStore, usePanelTerminal } from '@features/workspace';
import { t } from '@i18n';
import { isWithin, normalizeCommandPath } from '../model/commands';
import type { ExecutionContext } from '../services/execution';

export function useProjectScope() {
  const terminal = usePanelTerminal('command-history');
  const visible = useDockStore(state => [...state.leftPanels, ...state.rightPanels].includes('command-history'));
  const environment = terminal.spec ? commandEnvironment(terminal.spec) : null;
  const target = environment?.target ?? '';
  const cwd = terminal.cwd ?? '';
  const key = JSON.stringify([target, cwd]);
  const [resolved, setResolved] = useState<{ key: string; root: string } | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const connectionId = terminal.spec?.ssh?.connectionId;
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
  const context: ExecutionContext | null = resolved?.key === key && terminal.spec && terminal.paneId ? {
    target, cwd, root: resolved.root, spec: terminal.spec, paneId: terminal.paneId,
    scope: JSON.stringify([target, normalizeCommandPath(resolved.root)]),
  } : null;
  const chooseRoot = async (root: string) => {
    if (!isWithin(cwd, root)) throw new Error(t('The project root must contain the terminal directory.'));
    const context = await getCommandContext(cwd, root, connectionId);
    await saveProjectRootOverride(target, context.root);
    setResolved({ key, root: context.root });
    setError('');
  };
  return { context, error, visible, available: !!target && !!cwd, cwd, chooseRoot, kind: terminal.spec?.kind, retry: () => setAttempt(value => value + 1) };
}
