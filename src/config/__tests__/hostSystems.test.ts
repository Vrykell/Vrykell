import { afterEach, expect, it } from 'vitest';
import { useHostSystems } from '../hostSystems';

afterEach(() => { useHostSystems.setState({ systems: {} }); localStorage.removeItem('vrykell-host-systems'); });

it('persists observed systems and ignores empty observations', async () => {
  useHostSystems.getState().remember('remote', 'Linux');
  useHostSystems.getState().remember('remote', '');
  useHostSystems.setState({ systems: {} });
  localStorage.setItem('vrykell-host-systems', JSON.stringify({ state: { systems: { remote: 'Linux', invalid: 12 } }, version: 0 }));
  await useHostSystems.persist.rehydrate();
  expect(useHostSystems.getState().systems).toEqual({ remote: 'Linux' });
});
