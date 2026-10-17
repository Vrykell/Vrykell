import { beforeEach, expect, it } from 'vitest';
import { useCommandHistorySettings } from '../commandHistory';

beforeEach(() => { localStorage.clear(); useCommandHistorySettings.setState({ runIn: 'new', doubleClick: 'insert', migrated: false }); });
it('migrates the first legacy target once and preserves application choices across projects', () => {
  const store = useCommandHistorySettings.getState(); store.migrate('current'); store.migrate('new');
  expect(useCommandHistorySettings.getState().runIn).toBe('current');
  store.update({ runIn: 'new', doubleClick: 'run' }); store.migrate('current');
  expect(JSON.parse(localStorage.getItem('vrykell-command-history-settings')!).state).toMatchObject({ runIn: 'new', doubleClick: 'run' });
});
it('restores behavior after reload and rejects malformed values', async () => {
  useCommandHistorySettings.getState().update({ runIn: 'current', doubleClick: 'run' });
  useCommandHistorySettings.setState({ runIn: 'new', doubleClick: 'insert' }, false);
  localStorage.setItem('vrykell-command-history-settings', JSON.stringify({ state: { runIn: 'current', doubleClick: 'run', migrated: true }, version: 0 }));
  await useCommandHistorySettings.persist.rehydrate();
  expect(useCommandHistorySettings.getState()).toMatchObject({ runIn: 'current', doubleClick: 'run' });
  localStorage.setItem('vrykell-command-history-settings', JSON.stringify({ state: { runIn: 'bad', doubleClick: false }, version: 0 }));
  await useCommandHistorySettings.persist.rehydrate();
  expect(useCommandHistorySettings.getState()).toMatchObject({ runIn: 'new', doubleClick: 'insert' });
});
