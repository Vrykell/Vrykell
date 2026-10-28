/**
 * terminalTheme - theme config store (load/update/import/export + wallpaper cache).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { invokeMock, convertFileSrcMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  convertFileSrcMock: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock, convertFileSrc: convertFileSrcMock }));

import {
  useTerminalThemeStore, applyCachedWallpaper, reapplyXtermTheme, applyTerminalTheme, getThemePath,
} from '@features/settings/model/terminalTheme';

const baseConfig = { opacity: 1, backgroundImage: null, vars: {} };

beforeEach(() => {
  invokeMock.mockReset();
  convertFileSrcMock.mockReset();
  localStorage.removeItem('vrykell-wallpaper-url');
  useTerminalThemeStore.setState({ config: { ...baseConfig }, loaded: false, wallpaperDataUrl: null });
});

describe('terminalTheme store', () => {
  it('load: applies the config and caches the wallpaper URL', async () => {
    convertFileSrcMock.mockReturnValue('asset:///wall.jpg');
    invokeMock.mockResolvedValue({ opacity: 0.8, backgroundImage: '/a/wall.jpg', vars: { '--x': '1' } });
    await useTerminalThemeStore.getState().load();
    const s = useTerminalThemeStore.getState();
    expect(s.loaded).toBe(true);
    expect(s.config.opacity).toBe(0.8);
    expect(s.wallpaperDataUrl).toBe('asset:///wall.jpg');
    expect(localStorage.getItem('vrykell-wallpaper-url')).toBe('asset:///wall.jpg');
  });

  it('load: a backend failure marks loaded without throwing', async () => {
    invokeMock.mockRejectedValue(new Error('no backend'));
    await useTerminalThemeStore.getState().load();
    expect(useTerminalThemeStore.getState().loaded).toBe(true);
  });

  it('load: no caching when the background image is empty', async () => {
    invokeMock.mockResolvedValue({ ...baseConfig });
    await useTerminalThemeStore.getState().load();
    expect(useTerminalThemeStore.getState().wallpaperDataUrl).toBeNull();
    expect(localStorage.getItem('vrykell-wallpaper-url')).toBeNull();
  });

  it('update: merges config, refreshes the cache when the wallpaper changes, and stays silent on backend failure', async () => {
    convertFileSrcMock.mockReturnValue('asset:///new.jpg');
    invokeMock.mockResolvedValue(undefined);
    const s = useTerminalThemeStore.getState();
    await s.update({ opacity: 0.5 });
    expect(useTerminalThemeStore.getState().config.opacity).toBe(0.5);
    await s.update({ backgroundImage: '/b/new.jpg' });
    expect(useTerminalThemeStore.getState().wallpaperDataUrl).toBe('asset:///new.jpg');
    expect(localStorage.getItem('vrykell-wallpaper-url')).toBe('asset:///new.jpg');
    expect(invokeMock).toHaveBeenLastCalledWith('set_theme_config', expect.objectContaining({
      config: expect.objectContaining({ backgroundImage: '/b/new.jpg' }),
    }));
    invokeMock.mockRejectedValueOnce(new Error('boom'));
    await useTerminalThemeStore.getState().update({ opacity: 0.3 });
    expect(useTerminalThemeStore.getState().config.opacity).toBe(0.3);
  });

  it('update: does not apply the wallpaper URL before the backend authorization completes', async () => {
    convertFileSrcMock.mockReturnValue('asset:///late.jpg');
    let release: () => void = () => {};
    invokeMock.mockImplementation(() => new Promise<void>(resolve => { release = () => resolve(); }));
    const pending = useTerminalThemeStore.getState().update({ backgroundImage: '/c/late.jpg' });
    expect(useTerminalThemeStore.getState().wallpaperDataUrl).toBeNull();
    release();
    await pending;
    expect(useTerminalThemeStore.getState().wallpaperDataUrl).toBe('asset:///late.jpg');
    expect(localStorage.getItem('vrykell-wallpaper-url')).toBe('asset:///late.jpg');
  });

  it('exportTo / importFrom pass through to the backend', async () => {
    convertFileSrcMock.mockReturnValue('asset:///imp.jpg');
    invokeMock.mockResolvedValueOnce(undefined);
    await useTerminalThemeStore.getState().exportTo('/tmp/t.json');
    expect(invokeMock).toHaveBeenCalledWith('theme_export', { path: '/tmp/t.json' });
    invokeMock.mockResolvedValueOnce({ opacity: 1, backgroundImage: '/i/imp.jpg', vars: {} });
    await useTerminalThemeStore.getState().importFrom('/tmp/t.json');
    expect(invokeMock).toHaveBeenCalledWith('theme_import', { path: '/tmp/t.json' });
    expect(useTerminalThemeStore.getState().wallpaperDataUrl).toBe('asset:///imp.jpg');
  });

  it('getThemePath: returns the backend theme file path', async () => {
    invokeMock.mockResolvedValueOnce('/home/me/.vrykell/theme.json');
    await expect(getThemePath()).resolves.toBe('/home/me/.vrykell/theme.json');
    expect(invokeMock).toHaveBeenLastCalledWith('get_theme_path');
  });

  it('applyCachedWallpaper: applies synchronously when a cache exists', () => {
    localStorage.setItem('vrykell-wallpaper-url', 'asset:///cached.jpg');
    applyCachedWallpaper();
    expect(useTerminalThemeStore.getState().wallpaperDataUrl).toBe('asset:///cached.jpg');
    localStorage.removeItem('vrykell-wallpaper-url');
    useTerminalThemeStore.setState({ wallpaperDataUrl: null });
    applyCachedWallpaper();
    expect(useTerminalThemeStore.getState().wallpaperDataUrl).toBeNull();
  });

  it('reapplyXtermTheme / applyTerminalTheme do not throw', () => {
    expect(() => reapplyXtermTheme()).not.toThrow();
    expect(() => applyTerminalTheme({ opacity: 1, backgroundImage: null, vars: { '--xterm-bg': '#111' } })).not.toThrow();
    expect(() => applyTerminalTheme({ opacity: 1, backgroundImage: null, vars: {} }, 'dark')).not.toThrow();
  });
});
