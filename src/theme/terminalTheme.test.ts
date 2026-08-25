import { describe, it, expect, vi, beforeEach } from 'vitest';

const { invokeMock, convertFileSrcMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  convertFileSrcMock: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
  convertFileSrc: convertFileSrcMock,
}));

import { applyTerminalTheme, applyCachedWallpaper, useTerminalThemeStore } from './terminalTheme';
import { setThemeOverrides } from './tokens';

const BASE = { opacity: 1, backgroundImage: null as string | null, vars: {} as Record<string, string> };

describe('terminalTheme store（壁纸解析）', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    convertFileSrcMock.mockReset();
    localStorage.clear();
    useTerminalThemeStore.setState({ config: { ...BASE }, wallpaperDataUrl: null, loaded: true });
    setThemeOverrides({});
  });

  it('设置背景图片时把本地路径转为 asset URL 并存入 wallpaperDataUrl', async () => {
    convertFileSrcMock.mockReturnValue('asset://localhost/%2Ftmp%2Fbg.png');
    await useTerminalThemeStore.getState().update({ backgroundImage: '/tmp/bg.png' });
    expect(convertFileSrcMock).toHaveBeenCalledWith('/tmp/bg.png');
    expect(useTerminalThemeStore.getState().wallpaperDataUrl).toBe('asset://localhost/%2Ftmp%2Fbg.png');
  });

  it('清除背景图片时 wallpaperDataUrl 为 null', async () => {
    await useTerminalThemeStore.getState().update({ backgroundImage: null });
    expect(useTerminalThemeStore.getState().wallpaperDataUrl).toBe(null);
  });

  it('转换失败时 wallpaperDataUrl 回退为 null', async () => {
    convertFileSrcMock.mockImplementation(() => {
      throw new Error('bad path');
    });
    await useTerminalThemeStore.getState().update({ backgroundImage: '/tmp/bg.png' });
    expect(useTerminalThemeStore.getState().wallpaperDataUrl).toBe(null);
  });

  it('applyCachedWallpaper 从缓存同步应用壁纸 URL', () => {
    localStorage.setItem('vrykell-wallpaper-url', 'asset://localhost/%2Ftmp%2Fbg.png');
    useTerminalThemeStore.setState({ wallpaperDataUrl: null });
    applyCachedWallpaper();
    expect(useTerminalThemeStore.getState().wallpaperDataUrl).toBe('asset://localhost/%2Ftmp%2Fbg.png');
  });
});

describe('applyTerminalTheme', () => {
  beforeEach(() => setThemeOverrides({}));

  it('把 vars 覆盖叠加到基础主题上', () => {
    applyTerminalTheme({ opacity: 1, backgroundImage: null, vars: { '--canvas': '#ff0000' } });
    expect(document.documentElement.style.getPropertyValue('--canvas')).toBe('#ff0000');
  });
});
