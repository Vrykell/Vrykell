import { afterEach, expect, it, vi } from 'vitest';
import { checkApplicationUpdate, supportsAppUpdates } from '../updater';
import { check } from '@tauri-apps/plugin-updater';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }));
vi.mock('@tauri-apps/plugin-updater', () => ({ check: vi.fn(async () => null) }));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

it('never checks for updates in portable builds', async () => {
  vi.stubEnv('VITE_DISABLE_UPDATES', 'true');
  expect(supportsAppUpdates()).toBe(false);
  expect(await checkApplicationUpdate()).toBeNull();
  expect(check).not.toHaveBeenCalled();
});

it('retains explicit update checks in installed builds', async () => {
  vi.stubEnv('VITE_DISABLE_UPDATES', '');
  expect(supportsAppUpdates()).toBe(true);
  await checkApplicationUpdate();
  expect(check).toHaveBeenCalledWith({ timeout: 15000 });
});
