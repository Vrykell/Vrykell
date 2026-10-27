import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
const material = vi.hoisted(() => ({ setTheme: vi.fn(), setEffects: vi.fn(), clearEffects: vi.fn() }));
const platform = vi.hoisted(() => ({ nativeMaterial: true, mac: false }));
vi.mock('@platform/runtime', () => ({
  get supportsNativeMaterial() { return platform.nativeMaterial; },
  get isMacOS() { return platform.mac; },
}));
vi.mock('@tauri-apps/api/window', () => ({ Effect: { Acrylic: 'acrylic', Sidebar: 'sidebar' }, getCurrentWindow: () => material }));
vi.mock('@platform/diagnostics', () => ({ invoke: invokeMock, diagnostic: vi.fn() }));

import { syncWindowFrame, syncWindowMaterial } from '../windowChrome';

const root = () => document.documentElement;

beforeEach(() => {
  vi.clearAllMocks();
  platform.nativeMaterial = true; platform.mac = false;
  invokeMock.mockResolvedValue(undefined);
  root().removeAttribute('style');
  delete root().dataset.toolWindow;
  delete root().dataset.nativeMaterial;
});

afterEach(() => { vi.clearAllMocks(); });

it('paints the main window frame with the neutral gray border', () => {
  root().style.setProperty('--chrome-bg', '#303030');
  root().style.setProperty('--surface', '#2B2B2B');
  root().style.setProperty('--border-strong', '#4B4E52');

  syncWindowFrame();

  expect(invokeMock).toHaveBeenCalledWith('apply_window_frame', { color: '#4B4E52' });
});

it('uses the same gray border for tool windows in the light theme', () => {
  root().dataset.toolWindow = 'true';
  root().style.setProperty('--chrome-bg', '#303030');
  root().style.setProperty('--surface', '#F5F5F5');
  root().style.setProperty('--border-strong', '#B9C2C8');

  syncWindowFrame();

  expect(invokeMock).toHaveBeenCalledWith('apply_window_frame', { color: '#B9C2C8' });
});

it('keeps the previous frame when the theme has no color for it', () => {
  syncWindowFrame();

  expect(invokeMock).not.toHaveBeenCalled();
});

it('ignores a rejected frame update', async () => {
  root().style.setProperty('--border-strong', 'rgb(75, 78, 82)');
  invokeMock.mockRejectedValue(new Error('window unavailable'));

  syncWindowFrame();
  await Promise.resolve();

  expect(invokeMock).toHaveBeenCalledWith('apply_window_frame', { color: 'rgb(75, 78, 82)' });
});

it('uses the live translucent backdrop and clears it when disabled', async () => {
  root().style.setProperty('--border-strong', '#4B4E52');
  await syncWindowMaterial(true, 'dark');
  expect(material.setTheme).toHaveBeenCalledWith('dark');
  expect(material.setEffects).toHaveBeenCalledWith({ effects: ['acrylic'] });
  expect(invokeMock).toHaveBeenCalledWith('apply_window_frame', { color: '#4B4E52' });
  await syncWindowMaterial(false, 'light');
  expect(material.setTheme).toHaveBeenLastCalledWith('light');
  expect(material.clearEffects).toHaveBeenCalledTimes(2);
});

it('retains the last choice when multiple material updates are queued', async () => {
  await Promise.all([syncWindowMaterial(true, 'dark'), syncWindowMaterial(false, 'light')]);
  expect(material.setEffects).not.toHaveBeenCalled();
  expect(material.clearEffects).toHaveBeenCalledOnce();
  material.setTheme.mockRejectedValueOnce(new Error('unsupported'));
  await expect(syncWindowMaterial(true, 'dark')).resolves.toBeUndefined();
  expect(root().dataset.nativeMaterial).toBe('fallback');
  await syncWindowMaterial(false, 'light');
  expect(material.clearEffects).toHaveBeenCalledTimes(2);
});

it('uses the native sidebar material on a supported desktop', async () => {
  platform.nativeMaterial = true; platform.mac = true;
  await syncWindowMaterial(true, 'light');
  expect(material.setEffects).toHaveBeenCalledWith({ effects: ['sidebar'] });
  expect(root().dataset.nativeMaterial).toBe('active');
});

it('publishes a CSS fallback when the compositor has no native material implementation', async () => {
  platform.nativeMaterial = false; platform.mac = false;
  await syncWindowMaterial(true, 'dark');
  expect(material.setEffects).not.toHaveBeenCalled();
  expect(root().dataset.nativeMaterial).toBe('fallback');
  await syncWindowMaterial(false, 'dark');
  expect(root().dataset.nativeMaterial).toBe('off');
});
