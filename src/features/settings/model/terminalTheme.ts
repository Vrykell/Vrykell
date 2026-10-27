/**
 * terminalTheme — app theme appearance store (opacity / background image / CSS variable overrides).
 *
 * The source of truth is the backend `~/.vrykell/theme.json`; the frontend store mirrors it reactively and applies changes immediately.
 *
 * Wallpaper and opacity are applied in the view layer (the App.tsx wallpaper background plus content opacity),
 * without relying on CSS var() url resolution, so rendering is more reliable and testable.
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
  /** Native desktop color is visible only through the outer navigation frame. */
  desktopTint?: boolean;
  /** Application opacity, 0.5..=1 (1 = fully opaque). */
  opacity: number;
  /** Absolute local path of the wallpaper; null = solid color background */
  backgroundImage: string | null;
  /** CSS variable override map (theme appearance) */
  vars: Record<string, string>;
}

const DEFAULT_CONFIG: TerminalThemeConfig = {
  desktopTint: true,
  opacity: 1,
  backgroundImage: null,
  vars: {},
};

/** Absolute path of the theme file (`~/.vrykell/theme.json`). */
export function getThemePath(): Promise<string> {
  return invoke<string>('get_theme_path');
}

// localStorage cache of the wallpaper asset URL: the URL is small, applied synchronously at startup, and the wallpaper is read from the local file through the asset protocol
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

/** Applies the last cached wallpaper URL synchronously at startup to avoid a black background while loading asynchronously. */
export function applyCachedWallpaper(): void {
  const cached = readCachedWallpaper();
  if (cached) {
    useTerminalThemeStore.setState({ wallpaperDataUrl: cached });
  }
}

/** Local wallpaper path → asset URL (the asset protocol reads the local file directly, with no base64 / large IPC payload). */
function resolveWallpaperUrl(path: string | null): string | null {
  if (!path) return null;
  try {
    return convertFileSrc(path);
  } catch (e) {
    console.warn('[terminalTheme] 转换壁纸路径失败:', e);
    return null;
  }
}

/** Reapplies the theme to every terminal instance (syncs background/cursor/selection/scrollbar thumb when the color scheme or overrides change). */
export function reapplyXtermTheme(): void {
  const theme = readXtermTheme();
  const cs = getComputedStyle(document.documentElement);
  // Scrollbar thumb colors match the block list scrollbar (theme.css)
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
      /* ignore: the instance may be being destroyed */
    }
  }
}

/** Applies synchronously: color overrides + terminal theme. mode defaults to the current data-theme. */
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
  /** Resolved wallpaper data URL (used directly by the view's background layer) */
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
