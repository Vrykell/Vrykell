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
  // 冷调石墨灰底（带一丝蓝，比纯灰更「设计感」），叠壁纸时不显灰扑扑
  canvas: '#0B0D11',          // 主背景（冷黑，侧栏与终端统一）
  surface: '#0B0D11',         // 与终端同色
  block: '#14171C',           // 对话框/命令块（亮一档，冷）
  elevated: '#1E222A',        // 浮层（再亮一档）
  hover: 'rgba(255,255,255,0.06)',
  buttonHover: '#1A1E25',

  border: '#242931',
  borderStrong: '#333A45',
  inputBorder: 'rgba(255,255,255,0.09)',

  // 文字
  textPrimary: '#E8EAEF',
  textSecondary: '#99A1AD',
  textMuted: '#626B78',

  // 主色：清透青绿（更干净、与冷灰对比清楚）
  accent: '#57D4C2',
  accentDim: 'rgba(87,212,194,0.22)',
  accentText: '#06201C',

  // 信息检索：冷蓝
  accentBlue: '#6FB6E8',
  accentBlueDim: 'rgba(111,182,232,0.20)',
  accentBlueStrong: '#8FC8EE',

  // AI 语义：暖琥珀（与主色冷暖分离，语义清晰）
  accentWarm: '#E2A878',
  accentWarmDim: 'rgba(226,168,120,0.18)',

  // 用户消息：浅灰
  accentUser: '#9AA1AD',
  accentUserDim: 'rgba(154,161,173,0.14)',

  // 语义色
  success: '#6FCF7C',
  successDim: 'rgba(111,207,124,0.15)',
  error: '#F06A6A',
  errorDim: 'rgba(240,106,106,0.15)',
  errorLight: '#F0928A',
  warning: '#E0B34A',

  blockCmdText: '#D6DAE2',
  blockCmdFailed: '#F0928A',
  blockDivider: 'rgba(255,255,255,0.07)',

  // 终端语法高亮
  cmdFlag: '#7FB8E6',         // 冷蓝
  cmdPath: '#5BD4C2',         // 主色青绿
  cmdPipe: '#9B8CE8',         // 柔紫
  cmdRedirect: '#9B8CE8',
  cmdString: '#D9B98A',       // 暖沙

  searchHighlightBg: 'rgba(87,212,194,0.22)',

  shellConnected: '#6FCF7C',
  shellDisconnected: '#6B7280',

  overlay: 'rgba(0,0,0,0.55)',
  overlayLight: 'rgba(0,0,0,0.40)',
  shadowSm: '0 1px 3px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.04)',
  shadowMd: '0 4px 14px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.06)',
  shadowLg: '0 10px 30px rgba(0,0,0,0.65), inset 0 1px 0 rgba(255,255,255,0.06)',

  accentBg: 'rgba(87,212,194,0.08)',
  accentBgStrong: '#1A2026',
  successBg: 'rgba(111,207,124,0.10)',
  errorBg: 'rgba(240,106,106,0.10)',
  errorBadgeBg: 'rgba(240,106,106,0.08)',

  tuiBanner: '#E2A878',
  codeBg: 'rgba(255,255,255,0.05)',
  thBg: 'rgba(255,255,255,0.04)',
  commandBlockBg: 'rgba(255,255,255,0.025)',
  scrollbarThumb: 'rgba(255,255,255,0.14)',
  scrollbarThumbHover: 'rgba(255,255,255,0.22)',
  apiKeyBg: 'rgba(87,212,194,0.08)',
  apiKeyBorder: 'rgba(87,212,194,0.28)',

  xtermBg: '#0B0D11',
  xtermCursor: '#CFD3DB',
  xtermSelection: 'rgba(255,255,255,0.18)',
};

// ── Light ──

const light: ThemePalette = {
  // 冷调浅灰底（带一丝蓝），与暗色同构
  canvas: '#FBFCFD',          // editor.background
  surface: '#F3F5F7',         // sideBar.background
  block: '#ECEEF1',
  elevated: '#E4E7EB',
  hover: 'rgba(0,0,0,0.05)',
  buttonHover: '#E4E7EB',

  border: '#D7DBE0',
  borderStrong: '#C2C8CF',
  inputBorder: 'rgba(0,0,0,0.12)',

  textPrimary: '#1A1D22',
  textSecondary: '#545B66',
  textMuted: '#8A909B',

  accent: '#1E9E8C',
  accentDim: 'rgba(30,158,140,0.15)',
  accentText: '#FFFFFF',

  accentBlue: '#2E7FB8',
  accentBlueDim: 'rgba(46,127,184,0.16)',
  accentBlueStrong: '#1E6FA8',

  accentWarm: '#C07A2E',
  accentWarmDim: 'rgba(192,122,46,0.14)',

  accentUser: '#545B66',
  accentUserDim: 'rgba(84,91,102,0.12)',

  success: '#2F8A3A',
  successDim: 'rgba(47,138,58,0.12)',
  error: '#C23A3A',
  errorDim: 'rgba(194,58,58,0.1)',
  errorLight: '#D65A5A',
  warning: '#9A7415',

  blockCmdText: '#33383F',
  blockCmdFailed: '#D65A5A',
  blockDivider: 'rgba(0,0,0,0.08)',

  cmdFlag: '#2E7FB8',
  cmdPath: '#1E9E8C',
  cmdPipe: '#6B5BB0',
  cmdRedirect: '#6B5BB0',
  cmdString: '#A87E3A',

  searchHighlightBg: 'rgba(30,158,140,0.16)',

  shellConnected: '#2F8A3A',
  shellDisconnected: '#8A909B',

  overlay: 'rgba(0,0,0,0.15)',
  overlayLight: 'rgba(0,0,0,0.1)',
  shadowSm: '0 1px 3px rgba(0,0,0,0.10), inset 0 1px 0 rgba(255,255,255,0.5)',
  shadowMd: '0 4px 14px rgba(0,0,0,0.14), inset 0 1px 0 rgba(255,255,255,0.6)',
  shadowLg: '0 10px 30px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.6)',

  accentBg: 'rgba(30,158,140,0.08)',
  accentBgStrong: '#D8DEE3',
  successBg: 'rgba(47,138,58,0.08)',
  errorBg: 'rgba(194,58,58,0.07)',
  errorBadgeBg: 'rgba(194,58,58,0.05)',

  tuiBanner: '#C07A2E',
  codeBg: 'rgba(0,0,0,0.04)',
  thBg: 'rgba(0,0,0,0.03)',
  commandBlockBg: 'rgba(0,0,0,0.02)',
  scrollbarThumb: 'rgba(0,0,0,0.18)',
  scrollbarThumbHover: 'rgba(0,0,0,0.3)',
  apiKeyBg: 'rgba(30,158,140,0.08)',
  apiKeyBorder: 'rgba(30,158,140,0.25)',

  xtermBg: '#FBFCFD',
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
