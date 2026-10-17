/**
 * terminalTheme — 应用主题外观配置 store（透明度 / 背景图片 / CSS 变量覆盖）。
 *
 * 真相源在 Rust 后端 `~/.vrykell/theme.json`；前端 store 做响应式镜像 + 即时应用。
 *
 * 壁纸与不透明度在 React 层落地（App.tsx 的壁纸背景层 + 内容 opacity），
 * 不依赖 CSS var() 的 url 解析，渲染更可靠、可测试。
 */

import { create } from 'zustand';
import { convertFileSrc } from '@tauri-apps/api/core';
import { invoke } from '@platform/diagnostics';
import {
  applyTheme,
  getCurrentTheme,
  setThemeOverrides,
  type ThemeMode,
} from '@config/theme/tokens';
import { termInstances } from '@features/terminal';
import { readXtermTheme } from '@features/terminal/model/xtermTheme';
import { syncWindowFrame } from '@platform/windowChrome';

export interface TerminalThemeConfig {
  /** 应用整体不透明度 0.05..=1.0（1 = 完全不透明） */
  opacity: number;
  /** 应用壁纸本地绝对路径；null = 纯色背景 */
  backgroundImage: string | null;
  /** CSS 变量覆盖表（主题外观） */
  vars: Record<string, string>;
}

const DEFAULT_CONFIG: TerminalThemeConfig = {
  opacity: 1,
  backgroundImage: null,
  vars: {},
};

// 壁纸 asset URL 的 localStorage 缓存：URL 很小，启动时同步应用，壁纸直接经 asset 协议读本地文件
const WALLPAPER_CACHE_KEY = 'vrykell-wallpaper-url';

function readCachedWallpaper(): string | null {
  try {
    return localStorage.getItem(WALLPAPER_CACHE_KEY);
  } catch {
    return null;
  }
}

function cacheWallpaper(url: string | null): void {
  try {
    if (url) localStorage.setItem(WALLPAPER_CACHE_KEY, url);
    else localStorage.removeItem(WALLPAPER_CACHE_KEY);
  } catch {
    /* ignore */
  }
}

/** 启动时同步应用上次缓存的壁纸 URL，避免异步加载期间的黑色背景。 */
export function applyCachedWallpaper(): void {
  const cached = readCachedWallpaper();
  if (cached) {
    useTerminalThemeStore.setState({ wallpaperDataUrl: cached });
  }
}

/** 本地壁纸路径 → asset URL（asset 协议直接读本地文件，无需 base64 / IPC 大串传输）。 */
function resolveWallpaperUrl(path: string | null): string | null {
  if (!path) return null;
  try {
    return convertFileSrc(path);
  } catch (e) {
    console.warn('[terminalTheme] 转换壁纸路径失败:', e);
    return null;
  }
}

/** 重应用所有 xterm 实例的主题（明暗/颜色覆盖变化时同步背景/光标/选区/滚动条滑块）。 */
export function reapplyXtermTheme(): void {
  const theme = readXtermTheme();
  const cs = getComputedStyle(document.documentElement);
  // 滚动条滑块颜色与 block 列表滚动条(theme.css)一致
  const thumb = cs.getPropertyValue('--scrollbar-thumb').trim() || 'rgba(255,255,255,0.14)';
  const thumbHover = cs.getPropertyValue('--scrollbar-thumb-hover').trim() || 'rgba(255,255,255,0.22)';
  for (const t of termInstances.values()) {
    try {
      t.options.theme = {
        ...(t.options.theme ?? {}),
        ...theme,
        scrollbarSliderBackground: thumb,
        scrollbarSliderHoverBackground: thumbHover,
        scrollbarSliderActiveBackground: thumbHover,
      };
    } catch {
      /* ignore：实例可能正在销毁 */
    }
  }
}

/** 同步应用：颜色覆盖 + xterm 主题。mode 缺省时用当前 data-theme。 */
export function applyTerminalTheme(config: TerminalThemeConfig, mode?: ThemeMode): void {
  setThemeOverrides(config.vars ?? {});
  applyTheme(mode ?? getCurrentTheme());
  reapplyXtermTheme();
  // The native window frame follows the color that touches it.
  syncWindowFrame();
}

interface TerminalThemeState {
  config: TerminalThemeConfig;
  loaded: boolean;
  /** 已解析的壁纸 data URL（React 背景层直接使用） */
  wallpaperDataUrl: string | null;
  load: () => Promise<void>;
  update: (patch: Partial<TerminalThemeConfig>) => Promise<void>;
  exportTo: (path: string) => Promise<void>;
  importFrom: (path: string) => Promise<void>;
}

export const useTerminalThemeStore = create<TerminalThemeState>((set, get) => ({
  config: DEFAULT_CONFIG,
  loaded: false,
  wallpaperDataUrl: null,

  load: async () => {
    try {
      const config = await invoke<TerminalThemeConfig>('get_theme_config');
      const wallpaperDataUrl = resolveWallpaperUrl(config.backgroundImage);
      cacheWallpaper(wallpaperDataUrl);
      set({ config, loaded: true, wallpaperDataUrl });
      applyTerminalTheme(config);
    } catch {
      set({ loaded: true });
    }
  },

  update: async (patch) => {
    const prev = get().config;
    const config = { ...prev, ...patch };
    set({ config });
    applyTerminalTheme(config);
    try {
      // Persist first: the backend authorizes the new wallpaper file, and the webview must not
      // request its asset URL before that, or the one-shot image request is denied (403).
      await invoke('set_theme_config', { config });
    } catch {
      /* Ignore when the backend is unavailable: the frontend state already applied. */
    }
    if (config.backgroundImage !== prev.backgroundImage) {
      const wallpaperDataUrl = resolveWallpaperUrl(config.backgroundImage);
      cacheWallpaper(wallpaperDataUrl);
      set({ wallpaperDataUrl });
    }
  },

  exportTo: async (path) => {
    await invoke('theme_export', { path });
  },

  importFrom: async (path) => {
    const config = await invoke<TerminalThemeConfig>('theme_import', { path });
    const wallpaperDataUrl = resolveWallpaperUrl(config.backgroundImage);
    cacheWallpaper(wallpaperDataUrl);
    set({ config, wallpaperDataUrl });
    applyTerminalTheme(config);
  },
}));
