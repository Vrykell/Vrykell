import { afterEach, expect, it } from 'vitest';
import { useLocalPathStore } from '../services/localPath';
import { useRemotePathStore } from '@features/ssh/utils/remotePath';

afterEach(() => {
  useLocalPathStore.setState({ remembered: null }); useRemotePathStore.setState({ path: {} });
  useLocalPathStore.persist.clearStorage(); useRemotePathStore.persist.clearStorage();
});

it('persists only the last local location, including the drive view', async () => {
  useLocalPathStore.getState().remember('/first'); useLocalPathStore.getState().remember('/last');
  expect(JSON.parse(localStorage.getItem('vrykell-files-location')!).state).toEqual({ remembered: { path: '/last' } });
  localStorage.setItem('vrykell-files-location', JSON.stringify({ state: { remembered: { path: null }, history: ['/first'] }, version: 0 }));
  await useLocalPathStore.persist.rehydrate();
  expect(useLocalPathStore.getState().remembered).toEqual({ path: null });
  expect(useLocalPathStore.getState()).not.toHaveProperty('history');
});

it('remembers one directory per remote connection and rejects malformed saved data', async () => {
  useRemotePathStore.getState().set('first', '/one'); useRemotePathStore.getState().set('second', '/two');
  expect(JSON.parse(localStorage.getItem('vrykell-remote-files-locations')!).state).toEqual({ path: { first: '/one', second: '/two' } });
  localStorage.setItem('vrykell-remote-files-locations', JSON.stringify({ state: { path: { first: '/home/one', bad: 42, relative: 'bad', home: null }, history: ['/old'] }, version: 0 }));
  await useRemotePathStore.persist.rehydrate();
  expect(useRemotePathStore.getState().path).toEqual({ first: '/home/one', home: null });
  expect(useRemotePathStore.getState()).not.toHaveProperty('history');
});
