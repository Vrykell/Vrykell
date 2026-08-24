/**
 * terminalTheme — 应用主题外观配置 store（透明度 / 背景图片 / CSS 变量覆盖）。
 *
 * 真相源在 Rust 后端 `~/.vrykell/theme.json`；前端 store 做响应式镜像 + 即时应用。
 *
 * 壁纸与不透明度在 React 层落地（App.tsx 的壁纸背景层 + 内容 opacity），
 * 不依赖 CSS var() 的 url 解析，渲染更可靠、可测试。
 */

import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import {
  applyTheme,
  getCurrentTheme,
  setThemeOverrides,
  type ThemeMode,
} from './tokens';
import { termInstances } from '../stores/terminal';

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

/** 本地壁纸路径 → data URL（Tauri webview 不能直接 url() 本地路径）。 */
async function resolveWallpaperDataUrl(path: string | null): Promise<string | null> {
  if (!path) return null;
  try {
    return await invoke<string>('read_image_data_url', { path });
  } catch (e) {
    console.warn('[terminalTheme] 读取壁纸失败:', e);
    return null;
  }
}

/** 重应用所有 xterm 实例的主题（明暗/颜色覆盖变化时同步背景/光标/选区）。 */
export function reapplyXtermTheme(): void {
  const cs = getComputedStyle(document.documentElement);
  const bg = cs.getPropertyValue('--xterm-bg').trim() || '#050505';
  const cursor = cs.getPropertyValue('--xterm-cursor').trim() || '#e8e8e8';
  const selection = cs.getPropertyValue('--xterm-selection').trim() || 'rgba(255,255,255,0.25)';
  for (const t of termInstances.values()) {
    try {
      t.options.theme = {
        ...(t.options.theme ?? {}),
        background: bg,
        cursor,
        selectionBackground: selection,
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
      const wallpaperDataUrl = await resolveWallpaperDataUrl(config.backgroundImage);
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
    if (config.backgroundImage !== prev.backgroundImage) {
      const wallpaperDataUrl = await resolveWallpaperDataUrl(config.backgroundImage);
      set({ wallpaperDataUrl });
    }
    try {
      await invoke('set_theme_config', { config });
    } catch {
      /* 后端不可用时忽略（前端已即时生效） */
    }
  },

  exportTo: async (path) => {
    await invoke('theme_export', { path });
  },

  importFrom: async (path) => {
    const config = await invoke<TerminalThemeConfig>('theme_import', { path });
    const wallpaperDataUrl = await resolveWallpaperDataUrl(config.backgroundImage);
    set({ config, wallpaperDataUrl });
    applyTerminalTheme(config);
  },
}));
