import { afterEach, expect, it } from 'vitest';
import { useHostLibrary } from '../stores/hostLibrary';

afterEach(() => { useHostLibrary.setState({ hosts: {} }); localStorage.removeItem('vrykell-host-library'); });
it('persists host grouping, tags and favorites independently of credentials', async () => {
  useHostLibrary.getState().update('host', { group: 'Production', tags: ['api'], starred: true });
  await useHostLibrary.persist.rehydrate();
  expect(useHostLibrary.getState().hosts.host).toEqual({ group: 'Production', tags: ['api'], starred: true });
});
it('discards invalid metadata and caps saved tag lists', async () => {
  localStorage.setItem('vrykell-host-library', JSON.stringify({ state: { hosts: { host: { group: 4, tags: [1, 'api'], starred: 'yes' } } }, version: 0 }));
  await useHostLibrary.persist.rehydrate();
  expect(useHostLibrary.getState().hosts.host).toEqual({ group: '', tags: ['api'], starred: false });
});
it('moves a host between groups without losing tags or favorite status', async () => {
  useHostLibrary.getState().update('host', { group: 'Production', tags: ['api'], starred: true });
  useHostLibrary.getState().update('host', { group: 'Database' });
  await useHostLibrary.persist.rehydrate();
  expect(useHostLibrary.getState().hosts.host).toEqual({ group: 'Database', tags: ['api'], starred: true });
});
it('persists the per-host collection opt-out', async () => {
  useHostLibrary.getState().update('host', { resourceDisabled: true });
  await useHostLibrary.persist.rehydrate();
  expect(useHostLibrary.getState().hosts.host.resourceDisabled).toBe(true);
  useHostLibrary.getState().update('host', { resourceDisabled: false });
  await useHostLibrary.persist.rehydrate();
  expect(useHostLibrary.getState().hosts.host.resourceDisabled).not.toBe(true);
});
