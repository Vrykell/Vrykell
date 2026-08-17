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
  canvas: '#050505',
  surface: '#0d0d0d',
  block: '#131313',
  elevated: '#181818',
  hover: 'rgba(255,255,255,0.06)',
  buttonHover: '#181818',

  border: 'rgba(255,255,255,0.08)',
  borderStrong: 'rgba(255,255,255,0.14)',
  inputBorder: 'rgba(255,255,255,0.08)',

  textPrimary: '#ffffff',
  textSecondary: '#a0a5b0',
  textMuted: '#5c6370',

  accent: '#ffffff',
  accentDim: 'rgba(255,255,255,0.12)',

  accentBlue: '#ffffff',
  accentBlueDim: 'rgba(255,255,255,0.3)',
  accentBlueStrong: '#ffffff',

  accentWarm: '#d97757',
  accentWarmDim: 'rgba(217,119,87,0.25)',

  accentUser: '#8b6cff',
  accentUserDim: 'rgba(139,108,255,0.12)',

  success: '#1ca05a',
  successDim: 'rgba(28,160,90,0.13)',
  error: '#bc362a',
  errorDim: 'rgba(188,54,42,0.13)',
  errorLight: '#ff8a8a',
  warning: '#c28000',

  blockCmdText: '#c9cdd4',
  blockCmdFailed: '#ff8a8a',
  blockDivider: 'rgba(255,255,255,0.06)',

  cmdFlag: '#7ecfff',
  cmdPath: '#8be0b8',
  cmdPipe: '#8b6cff',
  cmdRedirect: '#8b6cff',
  cmdString: '#e5a050',

  searchHighlightBg: 'rgba(255,255,255,0.3)',

  shellConnected: '#4ade80',
  shellDisconnected: '#6b7280',

  overlay: 'rgba(0,0,0,0.35)',
  overlayLight: 'rgba(0,0,0,0.3)',
  shadowSm: '0 2px 12px rgba(0,0,0,0.3)',
  shadowMd: '0 4px 16px rgba(0,0,0,0.5)',
  shadowLg: '0 8px 32px rgba(0,0,0,0.55)',

  accentBg: 'rgba(255,255,255,0.1)',
  accentBgStrong: '#262626',
  successBg: 'rgba(28,160,90,0.13)',
  errorBg: 'rgba(188,54,42,0.13)',
  errorBadgeBg: 'rgba(188,54,42,0.09)',

  tuiBanner: '#d97757',
  codeBg: 'rgba(255,255,255,0.07)',
  thBg: 'rgba(255,255,255,0.05)',
  commandBlockBg: 'rgba(255,255,255,0.03)',
  scrollbarThumb: 'rgba(255,255,255,0.12)',
  scrollbarThumbHover: 'rgba(255,255,255,0.2)',
  apiKeyBg: 'rgba(210,153,34,0.12)',
  apiKeyBorder: 'rgba(210,153,34,0.35)',

  xtermBg: '#050505',
  xtermCursor: '#e8e8e8',
  xtermSelection: 'rgba(255,255,255,0.25)',
};

// ── Light ──

const light: ThemePalette = {
  canvas: '#ffffff',
  surface: '#f5f5f5',
  block: '#eeeeee',
  elevated: '#e8e8e8',
  hover: 'rgba(0,0,0,0.04)',
  buttonHover: '#e8e8e8',

  border: 'rgba(0,0,0,0.08)',
  borderStrong: 'rgba(0,0,0,0.14)',
  inputBorder: 'rgba(0,0,0,0.12)',

  textPrimary: '#1a1a1a',
  textSecondary: '#5c6370',
  textMuted: '#9ca3af',

  accent: '#0d7ea8',
  accentDim: 'rgba(13,126,168,0.12)',

  accentBlue: '#3b6fdd',
  accentBlueDim: 'rgba(59,111,221,0.25)',
  accentBlueStrong: '#3b6fdd',

  accentWarm: '#c05620',
  accentWarmDim: 'rgba(192,86,32,0.18)',

  accentUser: '#6c4fd9',
  accentUserDim: 'rgba(108,79,217,0.1)',

  success: '#1a7f4b',
  successDim: 'rgba(26,127,75,0.1)',
  error: '#c04040',
  errorDim: 'rgba(192,64,64,0.1)',
  errorLight: '#d04040',
  warning: '#b07800',

  blockCmdText: '#4b5563',
  blockCmdFailed: '#d04040',
  blockDivider: 'rgba(0,0,0,0.06)',

  cmdFlag: '#1a6fb5',
  cmdPath: '#1a7f4b',
  cmdPipe: '#6c4fd9',
  cmdRedirect: '#6c4fd9',
  cmdString: '#c05620',

  searchHighlightBg: 'rgba(59,111,221,0.25)',

  shellConnected: '#22c55e',
  shellDisconnected: '#9ca3af',

  overlay: 'rgba(0,0,0,0.15)',
  overlayLight: 'rgba(0,0,0,0.1)',
  shadowSm: '0 2px 12px rgba(0,0,0,0.08)',
  shadowMd: '0 4px 16px rgba(0,0,0,0.1)',
  shadowLg: '0 8px 32px rgba(0,0,0,0.12)',

  accentBg: 'rgba(13,126,168,0.1)',
  accentBgStrong: '#e0e0e0',
  successBg: 'rgba(26,127,75,0.1)',
  errorBg: 'rgba(192,64,64,0.1)',
  errorBadgeBg: 'rgba(192,64,64,0.06)',

  tuiBanner: '#c05620',
  codeBg: 'rgba(0,0,0,0.05)',
  thBg: 'rgba(0,0,0,0.03)',
  commandBlockBg: 'rgba(0,0,0,0.02)',
  scrollbarThumb: 'rgba(0,0,0,0.15)',
  scrollbarThumbHover: 'rgba(0,0,0,0.25)',
  apiKeyBg: 'rgba(210,153,34,0.1)',
  apiKeyBorder: 'rgba(210,153,34,0.3)',

  xtermBg: '#ffffff',
  xtermCursor: '#0d7ea8',
  xtermSelection: 'rgba(13,126,168,0.2)',
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

/** 将 palette 写入 :root，并标记 data-theme */
export function applyTheme(mode: ThemeMode): void {
  const vars = paletteToCssVars(themes[mode]);
  const root = document.documentElement;
  for (const [k, v] of Object.entries(vars)) {
    root.style.setProperty(k, v);
  }
  root.dataset.theme = mode;
}

export function getCurrentTheme(): ThemeMode {
  return (document.documentElement.dataset.theme as ThemeMode) || 'dark';
}
