/**
 * terminalTheme — 主题配置 store（load/update/import/export + 壁纸缓存）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { invokeMock, convertFileSrcMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  convertFileSrcMock: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock, convertFileSrc: convertFileSrcMock }));

import {
  useTerminalThemeStore, applyCachedWallpaper, reapplyXtermTheme, applyTerminalTheme,
} from './terminalTheme';

const baseConfig = { opacity: 1, backgroundImage: null, vars: {} };

beforeEach(() => {
  invokeMock.mockReset();
  convertFileSrcMock.mockReset();
  localStorage.removeItem('vrykell-wallpaper-url');
  useTerminalThemeStore.setState({ config: { ...baseConfig }, loaded: false, wallpaperDataUrl: null });
});

describe('terminalTheme store', () => {
  it('load：成功应用配置并缓存壁纸 URL', async () => {
    convertFileSrcMock.mockReturnValue('asset:///wall.jpg');
    invokeMock.mockResolvedValue({ opacity: 0.8, backgroundImage: '/a/wall.jpg', vars: { '--x': '1' } });
    await useTerminalThemeStore.getState().load();
    const s = useTerminalThemeStore.getState();
    expect(s.loaded).toBe(true);
    expect(s.config.opacity).toBe(0.8);
    expect(s.wallpaperDataUrl).toBe('asset:///wall.jpg');
    expect(localStorage.getItem('vrykell-wallpaper-url')).toBe('asset:///wall.jpg');
  });

  it('load：后端失败时标记 loaded 不抛错', async () => {
    invokeMock.mockRejectedValue(new Error('no backend'));
    await useTerminalThemeStore.getState().load();
    expect(useTerminalThemeStore.getState().loaded).toBe(true);
  });

  it('load：背景图为空时不缓存', async () => {
    invokeMock.mockResolvedValue({ ...baseConfig });
    await useTerminalThemeStore.getState().load();
    expect(useTerminalThemeStore.getState().wallpaperDataUrl).toBeNull();
    expect(localStorage.getItem('vrykell-wallpaper-url')).toBeNull();
  });

  it('update：合并配置、换壁纸时更新缓存、后端失败静默', async () => {
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

  it('exportTo / importFrom 透传后端', async () => {
    convertFileSrcMock.mockReturnValue('asset:///imp.jpg');
    invokeMock.mockResolvedValueOnce(undefined);
    await useTerminalThemeStore.getState().exportTo('/tmp/t.json');
    expect(invokeMock).toHaveBeenCalledWith('theme_export', { path: '/tmp/t.json' });
    invokeMock.mockResolvedValueOnce({ opacity: 1, backgroundImage: '/i/imp.jpg', vars: {} });
    await useTerminalThemeStore.getState().importFrom('/tmp/t.json');
    expect(invokeMock).toHaveBeenCalledWith('theme_import', { path: '/tmp/t.json' });
    expect(useTerminalThemeStore.getState().wallpaperDataUrl).toBe('asset:///imp.jpg');
  });

  it('applyCachedWallpaper：有缓存时同步应用', () => {
    localStorage.setItem('vrykell-wallpaper-url', 'asset:///cached.jpg');
    applyCachedWallpaper();
    expect(useTerminalThemeStore.getState().wallpaperDataUrl).toBe('asset:///cached.jpg');
    localStorage.removeItem('vrykell-wallpaper-url');
    useTerminalThemeStore.setState({ wallpaperDataUrl: null });
    applyCachedWallpaper();
    expect(useTerminalThemeStore.getState().wallpaperDataUrl).toBeNull();
  });

  it('reapplyXtermTheme / applyTerminalTheme 不抛错', () => {
    expect(() => reapplyXtermTheme()).not.toThrow();
    expect(() => applyTerminalTheme({ opacity: 1, backgroundImage: null, vars: { '--xterm-bg': '#111' } })).not.toThrow();
    expect(() => applyTerminalTheme({ opacity: 1, backgroundImage: null, vars: {} }, 'dark')).not.toThrow();
  });
});
