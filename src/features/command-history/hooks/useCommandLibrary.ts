import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { HistoryCommandDraft, HistoryCommandEntry, HistoryCommandPreferences } from '@core/commandHistory';
import { getHistoryPreferences, listCommandHistory, mutateHistoryCommand, saveHistoryPreferences } from '@platform/api/commandHistory';
import { commandKey, emptyPreferences, restoreRunningStatus, type CommandItem } from '../model/commands';
import { useBlockStore } from '@features/terminal';
import { announceCommandHistory, commandRevision, subscribeCommandHistory } from '../services/recording';
import type { ExecutionContext } from '../services/execution';
import { replaceGroupedCommand } from '../model/groups';
import { useCommandHistorySettings } from '@config/commandHistory';

export function useCommandLibrary(context: ExecutionContext, visible: boolean) {
  const [history, setHistory] = useState<HistoryCommandEntry[]>([]);
  const [preferences, setPreferences] = useState(emptyPreferences);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const revision = useSyncExternalStore(subscribeCommandHistory, commandRevision);
  const current = useRef(preferences);
  const queue = useRef(Promise.resolve());
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let canceled = false;
    setError('');
    void getHistoryPreferences(context.scope).then(value => {
      if (canceled) return;
      const next = { ...emptyPreferences(), ...value };
      useCommandHistorySettings.getState().migrate(next.runIn);
      delete next.runIn;
      current.current = next;
      setPreferences(next);
      setReady(true);
    }).catch(reason => { if (!canceled) setError(String(reason)); });
    return () => { canceled = true; };
  }, [context.scope, attempt]);
  useEffect(() => {
    if (!visible) return;
    let canceled = false;
    const refresh = () => { void listCommandHistory(context.target, context.root)
      .then(rows => { if (!canceled) {
        const active = new Set(Object.entries(useBlockStore.getState().byTab).flatMap(([paneId, blocks]) => blocks.filter(block => block.status === 'executing').map(block => `${paneId}:${block.id}`)));
        setHistory(restoreRunningStatus(rows, active));
      } })
      .catch(reason => { if (!canceled) setError(String(reason)); }); };
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => { canceled = true; clearInterval(timer); };
  }, [context.target, context.root, visible, revision, attempt]);
  const commit = useCallback(async (change: (value: HistoryCommandPreferences) => HistoryCommandPreferences,
    persist: (value: HistoryCommandPreferences) => Promise<HistoryCommandPreferences | void>) => {
    const previous = current.current;
    const next = change(current.current);
    current.current = next;
    setPreferences(next);
    const write = queue.current.catch(() => {}).then(() => persist(next));
    queue.current = write.then(() => {}, () => {});
    try {
      const saved = await write;
      if (mounted.current) {
        if (saved && current.current === next) { current.current = saved; setPreferences(saved); }
        setError('');
      }
    } catch (reason) {
      if (mounted.current) {
        if (current.current === next) { current.current = previous; setPreferences(previous); }
        setError(String(reason));
      }
      throw reason;
    }
  }, []);
  const persistPreferences = useCallback((change: (value: HistoryCommandPreferences) => HistoryCommandPreferences) =>
    commit(change, value => saveHistoryPreferences(context.scope, value)), [commit, context.scope]);
  const update = useCallback((change: (value: HistoryCommandPreferences) => HistoryCommandPreferences) => {
    void persistPreferences(change).catch(() => {});
  }, [persistPreferences]);
  const saveCommand = async (original: CommandItem | null, draft: HistoryCommandDraft) => {
    const previousKey = original ? commandKey(original) : null;
    const nextKey = commandKey(draft);
    const existing = original && history.some(item => commandKey(item) === previousKey) ? original : null;
    await commit(value => ({ ...replaceGroupedCommand(value, previousKey, nextKey),
      favorites: value.favorites.map(item => commandKey(item) === previousKey ? { ...item, ...draft } : item),
      hidden: value.hidden.filter(key => key !== previousKey && key !== nextKey),
    }), preferences => mutateHistoryCommand({ target: context.target, root: context.root, scope: context.scope,
      original: existing ? { shell: existing.shell, command: existing.command, cwd: existing.cwd } : null, draft, preferences }));
    announceCommandHistory();
  };
  const deleteCommand = async (item: CommandItem) => {
    const key = commandKey(item);
    await commit(value => ({ ...replaceGroupedCommand(value, key, null), favorites: value.favorites.filter(entry => commandKey(entry) !== key), hidden: value.hidden.filter(entry => entry !== key) }),
      preferences => mutateHistoryCommand({ target: context.target, root: context.root, scope: context.scope,
        original: { shell: item.shell, command: item.command, cwd: item.cwd }, draft: null, preferences }));
    announceCommandHistory();
  };
  return { history, preferences, ready, error, update, persistPreferences, saveCommand, deleteCommand, retry: () => {
    if (!ready) { setAttempt(value => value + 1); return; }
    update(value => value);
    void listCommandHistory(context.target, context.root).then(setHistory).catch(reason => setError(String(reason)));
  } };
}
