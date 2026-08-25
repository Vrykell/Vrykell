/**
 * 主题 Token 定义。
 * 所有颜色从此处集中管理 — 组件只用 `var(--xxx)` 引用。
 * 添加新主题只需新增一个 palette 对象。
 */

// ── 类型 ──

export interface ThemePalette {
  // 背景层（从深到浅）
  canvas: string;
  surface: string;
  block: string;
  elevated: string;
  hover: string;
  /** button:hover 背景 */
  buttonHover: string;

  // 边框
  border: string;
  borderStrong: string;
  /** InputEditor 未聚焦时的边框色 */
  inputBorder: string;

  // 文字
  textPrimary: string;
  textSecondary: string;
  textMuted: string;

  // 主强调色
  accent: string;
  accentDim: string;
  /** accent 背景上的文字色（保证对比度） */
  accentText: string;

  // 次强调色（shell 指示器/搜索高亮/InlineAI 前缀 等蓝色场景）
  accentBlue: string;
  accentBlueDim: string;
  accentBlueStrong: string;

  // AI / 暖色强调（AI 模式文字、运行中指示器、WSL shell）
  accentWarm: string;
  accentWarmDim: string;

  // 用户消息强调
  accentUser: string;
  accentUserDim: string;

  // 语义色
  success: string;
  successDim: string;
  error: string;
  errorDim: string;
  errorLight: string;   // 失败命令文字等浅红
  warning: string;

  // 命令块文字
  blockCmdText: string;       // 正常命令文字
  blockCmdFailed: string;     // 失败命令文字
  blockDivider: string;       // block 间 1px 分隔线

  // 命令语法高亮（）
  cmdFlag: string;            // --flag
  cmdPath: string;            // /path/to/file
  cmdPipe: string;            // | pipe
  cmdRedirect: string;        // > >> redirect
  cmdString: string;          // "quoted string"

  // 搜索高亮背景
  searchHighlightBg: string;

  // 终端/shell 状态点
  shellConnected: string;     // 绿色圆点
  shellDisconnected: string;  // 灰色圆点

  // 叠加层 & 阴影
  overlay: string;        // 模态遮罩
  overlayLight: string;   // 较浅遮罩（HistoryPanel）
  shadowSm: string;
  shadowMd: string;
  shadowLg: string;

  // 半透明强调背景（toast / badge 用）
  accentBg: string;
  accentBgStrong: string; // 激活态更亮的强调背景
  successBg: string;
  errorBg: string;
  errorBadgeBg: string;       // 失败退出码 badge

  // 特殊
  tuiBanner: string;
  codeBg: string;
  thBg: string;
  commandBlockBg: string;     // CommandBlock 微妙的背景
  scrollbarThumb: string;
  scrollbarThumbHover: string;
  apiKeyBg: string;
  apiKeyBorder: string;

  // xterm.js 主题
  xtermBg: string;
  xtermCursor: string;
  xtermSelection: string;
}

// ── Dark ──

const dark: ThemePalette = {
  // VSCode Dark+（官方色板）：中深灰背景 + 蓝 accent + 经典 syntax 色
  canvas: '#0A0A0A',          // 主背景（更黑，侧栏与终端统一）
  surface: '#0A0A0A',         // 与终端同色
  block: '#171717',           // 对话框/命令块（亮一档）
  elevated: '#242424',        // 浮层（再亮一档）
  hover: 'rgba(255,255,255,0.07)',
  buttonHover: '#1E1E1E',

  border: '#2A2A2A',
  borderStrong: '#3A3A3A',
  inputBorder: '#2E2E2E',

  // 文字
  textPrimary: '#E8E8E8',
  textSecondary: '#ABABAB',
  textMuted: '#6C6C6C',

  // 主色：点缀绿（选中/激活态，保证可辨识）
  accent: '#9AC8A8',
  accentDim: 'rgba(154,200,168,0.25)',
  accentText: '#0A0A0A',

  // 信息检索：亮灰绿
  accentBlue: '#90BF9F',
  accentBlueDim: 'rgba(144,191,159,0.22)',
  accentBlueStrong: '#A5CDB0',

  // AI 语义：更亮的绿
  accentWarm: '#A8D8B4',
  accentWarmDim: 'rgba(168,216,180,0.2)',

  // 用户消息：浅灰
  accentUser: '#A5A5A5',
  accentUserDim: 'rgba(165,165,165,0.15)',

  // 语义色（VSCode 提示色）
  success: '#89D185',
  successDim: 'rgba(137,209,133,0.15)',
  error: '#F14C4C',
  errorDim: 'rgba(241,76,76,0.15)',
  errorLight: '#F48771',
  warning: '#CCA700',

  blockCmdText: '#D4D4D4',
  blockCmdFailed: '#F48771',
  blockDivider: 'rgba(255,255,255,0.08)',

  // 终端语法高亮（VSCode Dark+ 官方 syntax）
  cmdFlag: '#90BF9F',         // 亮灰绿
  cmdPath: '#A8D8B4',         // 更亮绿
  cmdPipe: '#82B091',         // 中灰绿
  cmdRedirect: '#82B091',
  cmdString: '#AFC99F',       // 浅绿

  searchHighlightBg: 'rgba(144,191,159,0.28)',

  shellConnected: '#89D185',
  shellDisconnected: '#7A7A7A',

  overlay: 'rgba(0,0,0,0.45)',
  overlayLight: 'rgba(0,0,0,0.32)',
  shadowSm: '0 2px 12px rgba(0,0,0,0.35)',
  shadowMd: '0 4px 16px rgba(0,0,0,0.5)',
  shadowLg: '0 8px 32px rgba(0,0,0,0.6)',

  accentBg: 'rgba(255,255,255,0.06)',
  accentBgStrong: '#1E1E1E',
  successBg: 'rgba(137,209,133,0.12)',
  errorBg: 'rgba(241,76,76,0.12)',
  errorBadgeBg: 'rgba(241,76,76,0.08)',

  tuiBanner: '#A8D8B4',
  codeBg: 'rgba(255,255,255,0.06)',
  thBg: 'rgba(255,255,255,0.05)',
  commandBlockBg: 'rgba(255,255,255,0.03)',
  scrollbarThumb: 'rgba(139,139,139,0.3)',
  scrollbarThumbHover: 'rgba(139,139,139,0.5)',
  apiKeyBg: 'rgba(137,209,133,0.1)',
  apiKeyBorder: 'rgba(137,209,133,0.3)',

  xtermBg: '#0A0A0A',
  xtermCursor: '#C8C8C8',
  xtermSelection: 'rgba(255,255,255,0.16)',
};

// ── Light ──

const light: ThemePalette = {
  // VSCode Light+（官方色板）
  canvas: '#FFFFFF',          // editor.background
  surface: '#F3F3F3',         // sideBar.background
  block: '#ECECEC',
  elevated: '#E4E4E4',
  hover: 'rgba(0,0,0,0.05)',
  buttonHover: '#E4E4E4',

  border: '#D4D4D4',
  borderStrong: '#C0C0C0',
  inputBorder: '#D4D4D4',

  textPrimary: '#1F1F1F',
  textSecondary: '#5D5D5D',
  textMuted: '#8C8C8C',

  accent: '#3F7D54',
  accentDim: 'rgba(63,125,84,0.15)',
  accentText: '#FFFFFF',

  accentBlue: '#6FA183',
  accentBlueDim: 'rgba(111,161,131,0.18)',
  accentBlueStrong: '#59876B',

  accentWarm: '#84BF96',
  accentWarmDim: 'rgba(132,191,150,0.16)',

  accentUser: '#5D5D5D',
  accentUserDim: 'rgba(93,93,93,0.12)',

  success: '#2F8132',
  successDim: 'rgba(47,129,50,0.12)',
  error: '#A31515',
  errorDim: 'rgba(163,21,21,0.1)',
  errorLight: '#C94F4F',
  warning: '#795E26',

  blockCmdText: '#3B3B3B',
  blockCmdFailed: '#C94F4F',
  blockDivider: 'rgba(0,0,0,0.08)',

  cmdFlag: '#6FA183',
  cmdPath: '#84BF96',
  cmdPipe: '#59876B',
  cmdRedirect: '#59876B',
  cmdString: '#8FAA80',

  searchHighlightBg: 'rgba(95,138,111,0.16)',

  shellConnected: '#2F8132',
  shellDisconnected: '#8C8C8C',

  overlay: 'rgba(0,0,0,0.15)',
  overlayLight: 'rgba(0,0,0,0.1)',
  shadowSm: '0 2px 12px rgba(0,0,0,0.08)',
  shadowMd: '0 4px 16px rgba(0,0,0,0.12)',
  shadowLg: '0 8px 32px rgba(0,0,0,0.16)',

  accentBg: 'rgba(46,46,46,0.06)',
  accentBgStrong: '#D8D8D8',
  successBg: 'rgba(47,129,50,0.08)',
  errorBg: 'rgba(163,21,21,0.07)',
  errorBadgeBg: 'rgba(163,21,21,0.05)',

  tuiBanner: '#84BF96',
  codeBg: 'rgba(0,0,0,0.04)',
  thBg: 'rgba(0,0,0,0.03)',
  commandBlockBg: 'rgba(0,0,0,0.02)',
  scrollbarThumb: 'rgba(0,0,0,0.18)',
  scrollbarThumbHover: 'rgba(0,0,0,0.3)',
  apiKeyBg: 'rgba(26,127,55,0.08)',
  apiKeyBorder: 'rgba(26,127,55,0.25)',

  xtermBg: '#FFFFFF',
  xtermCursor: '#2E2E2E',
  xtermSelection: 'rgba(46,46,46,0.14)',
};

// ── 导出 ──

export type ThemeMode = 'dark' | 'light';

export const themes: Record<ThemeMode, ThemePalette> = { dark, light };

/** Palette → CSS 自定义属性映射 */
export function paletteToCssVars(p: ThemePalette): Record<string, string> {
  return {
    '--canvas': p.canvas,
    '--surface': p.surface,
    '--block': p.block,
    '--elevated': p.elevated,
    '--hover': p.hover,
    '--button-hover': p.buttonHover,
    '--border': p.border,
    '--border-strong': p.borderStrong,
    '--input-border': p.inputBorder,
    '--text-primary': p.textPrimary,
    '--text-secondary': p.textSecondary,
    '--text-muted': p.textMuted,
    '--accent': p.accent,
    '--accent-dim': p.accentDim,
    '--accent-text': p.accentText,
    '--accent-blue': p.accentBlue,
    '--accent-blue-dim': p.accentBlueDim,
    '--accent-blue-strong': p.accentBlueStrong,
    '--accent-warm': p.accentWarm,
    '--accent-warm-dim': p.accentWarmDim,
    '--accent-user': p.accentUser,
    '--accent-user-dim': p.accentUserDim,
    '--success': p.success,
    '--success-dim': p.successDim,
    '--error': p.error,
    '--error-dim': p.errorDim,
    '--error-light': p.errorLight,
    '--warning': p.warning,
    '--block-cmd-text': p.blockCmdText,
    '--block-cmd-failed': p.blockCmdFailed,
    '--block-divider': p.blockDivider,
    '--cmd-flag': p.cmdFlag,
    '--cmd-path': p.cmdPath,
    '--cmd-pipe': p.cmdPipe,
    '--cmd-redirect': p.cmdRedirect,
    '--cmd-string': p.cmdString,
    '--search-highlight-bg': p.searchHighlightBg,
    '--shell-connected': p.shellConnected,
    '--shell-disconnected': p.shellDisconnected,
    '--overlay': p.overlay,
    '--overlay-light': p.overlayLight,
    '--shadow-sm': p.shadowSm,
    '--shadow-md': p.shadowMd,
    '--shadow-lg': p.shadowLg,
    '--accent-bg': p.accentBg,
    '--accent-bg-strong': p.accentBgStrong,
    '--success-bg': p.successBg,
    '--error-bg': p.errorBg,
    '--error-badge-bg': p.errorBadgeBg,
    '--tui-banner': p.tuiBanner,
    '--code-bg': p.codeBg,
    '--th-bg': p.thBg,
    '--command-block-bg': p.commandBlockBg,
    '--scrollbar-thumb': p.scrollbarThumb,
    '--scrollbar-thumb-hover': p.scrollbarThumbHover,
    '--api-key-bg': p.apiKeyBg,
    '--api-key-border': p.apiKeyBorder,
    '--xterm-bg': p.xtermBg,
    '--xterm-cursor': p.xtermCursor,
    '--xterm-selection': p.xtermSelection,
    // 保持现有字体/几何变量不变（不在 palette 中管理）
  };
}

// ── 用户主题覆盖（终端主题配置的 vars，叠加在基础 palette 之上） ──

let overrides: Record<string, string> = {};

/** 设置 CSS 变量覆盖表（theme.json 的 vars）。空对象 = 无覆盖。 */
export function setThemeOverrides(o: Record<string, string>): void {
  overrides = o ?? {};
}

/** 读取当前 CSS 变量覆盖表。 */
export function getThemeOverrides(): Record<string, string> {
  return overrides;
}

/** 将 palette（叠加用户覆盖）写入 :root，并标记 data-theme */
export function applyTheme(mode: ThemeMode): void {
  const base = paletteToCssVars(themes[mode]);
  const vars = { ...base, ...overrides };
  const root = document.documentElement;
  for (const [k, v] of Object.entries(vars)) {
    root.style.setProperty(k, v);
  }
  root.dataset.theme = mode;
}

export function getCurrentTheme(): ThemeMode {
  return (document.documentElement.dataset.theme as ThemeMode) || 'dark';
}

/** 将 #rgb / #rrggbb 十六进制颜色转为 rgba() 字符串（alpha 0..1）；解析失败回退黑色。 */
export function hexToRgba(hex: string, alpha: number): string {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return `rgba(0, 0, 0, ${alpha})`;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** 将任意颜色（hex / rgb() / rgba()）转成带指定 alpha 的 rgba；其它格式原样返回。 */
export function toRgba(color: string, alpha: number): string {
  const c = color.trim();
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(c)) {
    return hexToRgba(c, alpha);
  }
  const m = /^rgba?\(\s*([^)]+)\)\s*$/.exec(c);
  if (m) {
    const parts = m[1].split(',').map((s) => s.trim());
    if (parts.length >= 3) {
      return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${alpha})`;
    }
  }
  return c;
}
