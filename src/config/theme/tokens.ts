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
  xtermForeground: string;
  xtermCursor: string;
  xtermSelection: string;
  xtermBlack: string;
  xtermRed: string;
  xtermGreen: string;
  xtermYellow: string;
  xtermBlue: string;
  xtermMagenta: string;
  xtermCyan: string;
  xtermWhite: string;
  xtermBrightBlack: string;
  xtermBrightRed: string;
  xtermBrightGreen: string;
  xtermBrightYellow: string;
  xtermBrightBlue: string;
  xtermBrightMagenta: string;
  xtermBrightCyan: string;
  xtermBrightWhite: string;
}

// ── Dark（默认：中性，主色不带任何颜色倾向） ──

const dark: ThemePalette = {
  // 应用外壳保持近黑，终端单独提亮一层，避免大块内容融进外壳。
  canvas: '#0A0A0A',
  surface: '#0A0A0A',
  block: '#171717',
  elevated: '#242424',
  hover: 'rgba(255,255,255,0.07)',
  buttonHover: '#1E1E1E',

  border: '#2A2A2A',
  borderStrong: '#3A3A3A',
  inputBorder: 'rgba(255,255,255,0.08)',

  // 文字
  textPrimary: '#E8E8E8',
  textSecondary: '#ABABAB',
  textMuted: '#6C6C6C',

  // 主色：中性浅灰（选中/激活态用明度差区分，不引入色相）
  accent: '#C2C7CF',
  accentDim: 'rgba(194,199,207,0.22)',
  accentText: '#0A0A0A',

  // 信息检索 / AI：默认同样中性（带色方案见 TEAL_THEME_PRESET）
  accentBlue: '#AEB4BE',
  accentBlueDim: 'rgba(174,180,190,0.20)',
  accentBlueStrong: '#C2C7CF',

  accentWarm: '#B8BCC4',
  accentWarmDim: 'rgba(184,188,196,0.18)',

  // 用户消息：浅灰
  accentUser: '#A5A5A5',
  accentUserDim: 'rgba(165,165,165,0.15)',

  // 功能性语义色（仅这类保留色相：成功/错误/警告/连接状态）
  success: '#89D185',
  successDim: 'rgba(137,209,133,0.15)',
  error: '#F14C4C',
  errorDim: 'rgba(241,76,76,0.15)',
  errorLight: '#F48771',
  warning: '#CCA700',

  blockCmdText: '#D4D4D4',
  blockCmdFailed: '#F48771',
  blockDivider: 'rgba(255,255,255,0.08)',

  // 终端语法高亮（命令内容的着色，非应用主色）
  cmdFlag: '#7ECFFF',
  cmdPath: '#8BE0B8',
  cmdPipe: '#8B6CFF',
  cmdRedirect: '#8B6CFF',
  cmdString: '#E5A050',

  searchHighlightBg: 'rgba(255,255,255,0.20)',

  shellConnected: '#89D185',
  shellDisconnected: '#7A7A7A',

  overlay: 'rgba(0,0,0,0.55)',
  overlayLight: 'rgba(0,0,0,0.32)',
  shadowSm: '0 1px 3px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.04)',
  shadowMd: '0 4px 14px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.06)',
  shadowLg: '0 10px 30px rgba(0,0,0,0.65), inset 0 1px 0 rgba(255,255,255,0.06)',

  accentBg: 'rgba(255,255,255,0.06)',
  accentBgStrong: '#1E1E1E',
  successBg: 'rgba(137,209,133,0.12)',
  errorBg: 'rgba(241,76,76,0.12)',
  errorBadgeBg: 'rgba(241,76,76,0.08)',

  tuiBanner: '#B8BCC4',
  codeBg: 'rgba(255,255,255,0.06)',
  thBg: 'rgba(255,255,255,0.05)',
  commandBlockBg: 'rgba(255,255,255,0.03)',
  scrollbarThumb: 'rgba(255,255,255,0.12)',
  scrollbarThumbHover: 'rgba(255,255,255,0.2)',
  apiKeyBg: 'rgba(255,255,255,0.06)',
  apiKeyBorder: 'rgba(255,255,255,0.18)',

  xtermBg: '#111417',
  xtermForeground: '#D6D9E0',
  xtermCursor: '#C9D1DB',
  xtermSelection: 'rgba(141,183,232,0.28)',
  // 低饱和 ANSI 色板：保留目录、路径、错误等语义，同时避免彩色噪声。
  xtermBlack: '#1B1F24',
  xtermRed: '#F28B82',
  xtermGreen: '#A8D5A2',
  xtermYellow: '#E6C98A',
  xtermBlue: '#8DB7E8',
  xtermMagenta: '#C5A4D8',
  xtermCyan: '#8FCFD0',
  xtermWhite: '#D6D9E0',
  xtermBrightBlack: '#66707C',
  xtermBrightRed: '#FF9A92',
  xtermBrightGreen: '#BFE8B7',
  xtermBrightYellow: '#F2DFA3',
  xtermBrightBlue: '#A9CCF5',
  xtermBrightMagenta: '#D7B7E8',
  xtermBrightCyan: '#B0E4E1',
  xtermBrightWhite: '#F3F5F8',
};

/**
 * TEAL_THEME_PRESET — 青绿自定义主题（覆盖变量，走 theme.json 自定义主题机制）。
 * 默认内置调色板保持中性；喜欢带色外观的用户可在设置页一键应用本预设。
 * 仅覆盖「带色相」的变量，结构/明度层级（含 shadow 内描边高光）沿用默认。
 */
export const TEAL_THEME_PRESET: Record<string, string> = {
  '--accent': '#57D4C2',
  '--accent-text': '#06201C',
  '--accent-dim': 'rgba(87,212,194,0.22)',
  '--accent-blue': '#6FB6E8',
  '--accent-blue-dim': 'rgba(111,182,232,0.20)',
  '--accent-blue-strong': '#8FC8EE',
  '--accent-warm': '#E2A878',
  '--accent-warm-dim': 'rgba(226,168,120,0.18)',
  '--accent-bg': 'rgba(87,212,194,0.08)',
  '--accent-bg-strong': '#1A2026',
  '--search-highlight-bg': 'rgba(87,212,194,0.22)',
  '--tui-banner': '#E2A878',
  '--api-key-bg': 'rgba(87,212,194,0.08)',
  '--api-key-border': 'rgba(87,212,194,0.28)',
  '--cmd-flag': '#7FB8E6',
  '--cmd-path': '#5BD4C2',
  '--cmd-pipe': '#9B8CE8',
  '--cmd-redirect': '#9B8CE8',
  '--cmd-string': '#D9B98A',
  '--shell-connected': '#6FCF7C',
  '--block-cmd-text': '#D6DAE2',
  '--block-cmd-failed': '#F0928A',
  '--block-divider': 'rgba(255,255,255,0.07)',
};

// ── Light（默认：中性，主色不带任何颜色倾向） ──

const light: ThemePalette = {
  canvas: '#FFFFFF',
  surface: '#F3F3F3',
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

  // 主色：中性深灰（浅色模式下带色相同样只在预设中出现）
  accent: '#4A4F57',
  accentDim: 'rgba(74,79,87,0.15)',
  accentText: '#FFFFFF',

  accentBlue: '#5B616B',
  accentBlueDim: 'rgba(91,97,107,0.15)',
  accentBlueStrong: '#3A3F47',

  accentWarm: '#4A4F57',
  accentWarmDim: 'rgba(74,79,87,0.12)',

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

  cmdFlag: '#2E7FB8',
  cmdPath: '#1E9E8C',
  cmdPipe: '#6B5BB0',
  cmdRedirect: '#6B5BB0',
  cmdString: '#A87E3A',

  searchHighlightBg: 'rgba(0,0,0,0.12)',

  shellConnected: '#2F8132',
  shellDisconnected: '#8C8C8C',

  overlay: 'rgba(0,0,0,0.15)',
  overlayLight: 'rgba(0,0,0,0.1)',
  shadowSm: '0 1px 3px rgba(0,0,0,0.10), inset 0 1px 0 rgba(255,255,255,0.5)',
  shadowMd: '0 4px 14px rgba(0,0,0,0.14), inset 0 1px 0 rgba(255,255,255,0.6)',
  shadowLg: '0 10px 30px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.6)',

  accentBg: 'rgba(46,46,46,0.06)',
  accentBgStrong: '#D8D8D8',
  successBg: 'rgba(47,129,50,0.08)',
  errorBg: 'rgba(163,21,21,0.07)',
  errorBadgeBg: 'rgba(163,21,21,0.05)',

  tuiBanner: '#4A4F57',
  codeBg: 'rgba(0,0,0,0.04)',
  thBg: 'rgba(0,0,0,0.03)',
  commandBlockBg: 'rgba(0,0,0,0.02)',
  scrollbarThumb: 'rgba(0,0,0,0.18)',
  scrollbarThumbHover: 'rgba(0,0,0,0.3)',
  apiKeyBg: 'rgba(46,46,46,0.06)',
  apiKeyBorder: 'rgba(46,46,46,0.18)',

  xtermBg: '#F8F9FB',
  xtermForeground: '#2B3038',
  xtermCursor: '#2E3742',
  xtermSelection: 'rgba(46,96,150,0.20)',
  xtermBlack: '#41454D',
  xtermRed: '#B42318',
  xtermGreen: '#2E7D32',
  xtermYellow: '#8A6500',
  xtermBlue: '#2166A5',
  xtermMagenta: '#7A4E9B',
  xtermCyan: '#087F8C',
  xtermWhite: '#F3F4F6',
  xtermBrightBlack: '#6B7280',
  xtermBrightRed: '#D33A2C',
  xtermBrightGreen: '#3F9443',
  xtermBrightYellow: '#A47B00',
  xtermBrightBlue: '#2F7EC5',
  xtermBrightMagenta: '#9364B5',
  xtermBrightCyan: '#1499A5',
  xtermBrightWhite: '#FFFFFF',
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
    '--xterm-foreground': p.xtermForeground,
    '--xterm-cursor': p.xtermCursor,
    '--xterm-selection': p.xtermSelection,
    '--xterm-black': p.xtermBlack,
    '--xterm-red': p.xtermRed,
    '--xterm-green': p.xtermGreen,
    '--xterm-yellow': p.xtermYellow,
    '--xterm-blue': p.xtermBlue,
    '--xterm-magenta': p.xtermMagenta,
    '--xterm-cyan': p.xtermCyan,
    '--xterm-white': p.xtermWhite,
    '--xterm-bright-black': p.xtermBrightBlack,
    '--xterm-bright-red': p.xtermBrightRed,
    '--xterm-bright-green': p.xtermBrightGreen,
    '--xterm-bright-yellow': p.xtermBrightYellow,
    '--xterm-bright-blue': p.xtermBrightBlue,
    '--xterm-bright-magenta': p.xtermBrightMagenta,
    '--xterm-bright-cyan': p.xtermBrightCyan,
    '--xterm-bright-white': p.xtermBrightWhite,
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
