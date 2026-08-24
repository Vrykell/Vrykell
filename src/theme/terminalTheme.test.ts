import { describe, it, expect, vi, beforeEach } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

import { applyTerminalTheme, useTerminalThemeStore } from './terminalTheme';
import { setThemeOverrides } from './tokens';

const BASE = { opacity: 1, backgroundImage: null as string | null, vars: {} as Record<string, string> };

describe('terminalTheme store（壁纸解析）', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    useTerminalThemeStore.setState({ config: { ...BASE }, wallpaperDataUrl: null, loaded: true });
    setThemeOverrides({});
  });

  it('设置背景图片时把本地路径解析为 data URL 并存入 wallpaperDataUrl', async () => {
    invokeMock.mockResolvedValue('data:image/png;base64,ZmFrZWltYWdl');
    await useTerminalThemeStore.getState().update({ backgroundImage: '/tmp/bg.png' });
    expect(invokeMock).toHaveBeenCalledWith('read_image_data_url', { path: '/tmp/bg.png' });
    expect(useTerminalThemeStore.getState().wallpaperDataUrl).toBe(
      'data:image/png;base64,ZmFrZWltYWdl',
    );
  });

  it('清除背景图片时 wallpaperDataUrl 为 null', async () => {
    await useTerminalThemeStore.getState().update({ backgroundImage: null });
    expect(useTerminalThemeStore.getState().wallpaperDataUrl).toBe(null);
  });

  it('读取壁纸失败时 wallpaperDataUrl 回退为 null', async () => {
    invokeMock.mockRejectedValue(new Error('读取失败'));
    await useTerminalThemeStore.getState().update({ backgroundImage: '/tmp/bg.png' });
    expect(useTerminalThemeStore.getState().wallpaperDataUrl).toBe(null);
  });
});

describe('applyTerminalTheme', () => {
  beforeEach(() => setThemeOverrides({}));

  it('把 vars 覆盖叠加到基础主题上', () => {
    applyTerminalTheme({ opacity: 1, backgroundImage: null, vars: { '--canvas': '#ff0000' } });
    expect(document.documentElement.style.getPropertyValue('--canvas')).toBe('#ff0000');
  });
});
