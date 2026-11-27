import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
const material = vi.hoisted(() => ({ setTheme: vi.fn(), setEffects: vi.fn(), clearEffects: vi.fn() }));
const platform = vi.hoisted(() => ({ nativeMaterial: true, mac: false }));
vi.mock('@platform/runtime', () => ({
  get supportsNativeMaterial() {
    return platform.nativeMaterial;
  },
  get isMacOS() {
    return platform.mac;
  },
  get isWindows() {
    return platform.nativeMaterial && !platform.mac;
  },
}));
vi.mock('@tauri-apps/api/window', () => ({ Effect: { Acrylic: 'acrylic', Sidebar: 'sidebar' }, getCurrentWindow: () => material }));
vi.mock('@platform/diagnostics', () => ({ invoke: invokeMock, diagnostic: vi.fn() }));

import { syncWindowFrame, syncWindowMaterial } from '../windowFrame';

const root = () => document.documentElement;

beforeEach(() => {
  vi.clearAllMocks();
  platform.nativeMaterial = true;
  platform.mac = false;
  invokeMock.mockResolvedValue(undefined);
  root().removeAttribute('style');
  delete root().dataset.toolWindow;
  delete root().dataset.nativeMaterial;
  delete root().dataset.nativeFrame;
});

afterEach(() => {
  vi.clearAllMocks();
});

it('lets the native compositor choose one window outline', async () => {
  await syncWindowFrame();
  await syncWindowFrame();
  expect(invokeMock).toHaveBeenCalledExactlyOnceWith('apply_window_frame');
  expect(root().dataset.nativeFrame).toBe('active');
});

it('keeps the web outline when native framing is unavailable', async () => {
  invokeMock.mockRejectedValue(new Error('window unavailable'));
  await syncWindowFrame();
  expect(root().dataset.nativeFrame).toBeUndefined();
});

it('uses the live translucent backdrop and clears it when disabled', async () => {
  await syncWindowMaterial(true, 'dark');
  expect(material.setTheme).toHaveBeenCalledWith('dark');
  expect(material.setEffects).toHaveBeenCalledWith({ effects: ['acrylic'] });
  expect(invokeMock).toHaveBeenCalledWith('apply_window_frame');
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
  platform.nativeMaterial = true;
  platform.mac = true;
  await syncWindowMaterial(true, 'light');
  expect(material.setEffects).toHaveBeenCalledWith({ effects: ['sidebar'] });
  expect(invokeMock).not.toHaveBeenCalled();
  expect(root().dataset.nativeMaterial).toBe('active');
});

it('publishes a CSS fallback when the compositor has no native material implementation', async () => {
  platform.nativeMaterial = false;
  platform.mac = false;
  await syncWindowMaterial(true, 'dark');
  expect(material.setEffects).not.toHaveBeenCalled();
  expect(root().dataset.nativeMaterial).toBe('fallback');
  await syncWindowMaterial(false, 'dark');
  expect(root().dataset.nativeMaterial).toBe('off');
});
