/**
 * Theme token definitions.
 * Every color is managed here — components only reference `var(--xxx)`.
 * A new theme only needs another palette object.
 */

// ── Types ──

export interface ThemePalette {
  /** Small controls and shell colors remain independently customizable. */
  iconColor: string;
  iconHoverColor: string;
  focusRing: string;
  /**
   * Model-vendor marks in the usage tables. They identify a vendor the way the terminal palette
   * identifies a token, so they carry their brand hue in both themes (a custom theme can still
   * override them).
   */
  brandAnthropic: string;
  brandOpenai: string;
  brandGemini: string;
  brandDeepseek: string;
  /** Usage charts: one hue for the bars, in both themes. */
  chartBar: string;

  /** Categorical colors keep group identity separate from status and active controls. */
  groupBlue: string;
  groupGreen: string;
  groupViolet: string;
  groupAmber: string;
  groupCyan: string;
  groupRose: string;
  groupOrange: string;
  shellZshAccent: string;
  groupCoral: string;

  /** Window titlebar surface. */
  chromeBg: string;
  /** Primary navigation keeps its own material tint and opaque fallback. */
  sidebarBg: string;
  /** Auxiliary panels retain their own opaque resting surface. */
  auxiliaryBg: string;
  chromeField: string;
  tabMenuBg: string;
  selectionBg: string;
  // Background layers (darkest to lightest)
  canvas: string;
  surface: string;
  /** Borderless content cards stay distinct from the page canvas. */
  cardBg: string;
  /** Editable fields sit above panel and floating surfaces. */
  fieldBg: string;
  /** Terminal and conversation inputs share this raised surface. */
  composerBg: string;
  block: string;
  elevated: string;
  hover: string;
  /** Hover background for buttons. */
  buttonHover: string;

  // Borders
  border: string;
  borderStrong: string;
  /** Low-contrast resting divider for resizable panes. */
  resizeDivider: string;
  /** Border color of an unfocused input editor. */
  inputBorder: string;

  // Text
  textPrimary: string;
  textSecondary: string;
  textMuted: string;

  // Primary accent
  accent: string;
  accentDim: string;
  /** Text color on accent backgrounds (kept contrast-safe). */
  accentText: string;

  // Secondary accent (blue roles: shell indicators, search highlights, inline AI prefixes)
  accentBlue: string;
  accentBlueDim: string;
  accentBlueStrong: string;

  // AI / warm accent (AI-mode text, running indicator, alternate shell)
  accentWarm: string;
  accentWarmDim: string;

  // User message accent
  accentUser: string;
  accentUserDim: string;
  /** Primary actions keep the send-button blue in both palette modes. */
  primaryAction: string;

  // Semantic colors
  success: string;
  successDim: string;
  error: string;
  errorText: string;
  dangerAction: string;
  dangerActionText: string;
  errorDim: string;
  errorLight: string;   // Light red for failed command text and similar
  warning: string;

  // Command block text
  blockCmdText: string;       // Normal command text
  blockCmdFailed: string;     // Failed command text
  blockDivider: string;       // 1px divider between blocks

  // Display-only command syntax colors.
  cmdProgram: string;
  cmdArgument: string;
  cmdNumber: string;
  cmdVariable: string;
  cmdFlag: string;            // --flag
  cmdPath: string;            // /path/to/file
  cmdPipe: string;            // | pipe
  cmdRedirect: string;        // > >> redirect
  cmdString: string;          // "quoted string"

  // Search highlight background
  searchHighlightBg: string;

  // Terminal/shell status dots
  shellConnected: string;     // Green dot
  shellDisconnected: string;  // Gray dot

  // Overlays & shadows
  overlay: string;        // Modal scrim
  overlayLight: string;   // Lighter scrim (history panel)
  shadowSm: string;
  shadowMd: string;
  shadowLg: string;

  // Translucent accent backgrounds (toasts / badges)
  accentBg: string;
  accentBgStrong: string; // Brighter accent background for the active state
  successBg: string;
  errorBg: string;
  errorBadgeBg: string;       // Failed exit-code badge

  // Special
  tuiBanner: string;
  codeBg: string;
  commandBlockBg: string;     // Subtle command block background
  aiBlockBg: string;
  failedBlockBg: string;
  scrollbarThumb: string;
  scrollbarThumbHover: string;
  apiKeyBg: string;
  apiKeyBorder: string;

  // Terminal theme
  xtermBg: string;
  xtermForeground: string;
  xtermCursor: string;
  textCaret: string;
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

// Structural colors have one source; component roles reuse these surface levels.
const DARK_SURFACES = {
  content: '#141414', canvas: '#202020', sidebar: '#28282B', card: '#282828',
  field: '#3C3C3C', elevated: '#303030', control: '#282828', hover: '#454545',
  border: '#38393B', borderStrong: '#4B4E52',
} as const;

const LIGHT_SURFACES = {
  content: '#F7F8F9', canvas: '#F7F8F9', sidebar: '#E9F0FA', card: '#F5F5F5',
  field: '#FFFFFF', elevated: '#FAFAFA', control: '#FFFFFF', hover: '#F2F2F2',
  border: '#DFE3E5', borderStrong: '#B9C2C8',
} as const;

// Syntax, charts, group swatches and session icons share these accent families.
const DARK_ACCENTS = {
  blue: '#52ACFF', green: '#30D158', violet: '#DF7FFF', amber: '#F5C400',
  cyan: '#00CFA5', rose: '#FF5CA8', orange: '#FF9F0A', coral: '#FF7066',
  sky: '#32BFFF', magenta: '#E97AFF',
} as const;
const LIGHT_ACCENTS = {
  blue: '#005DCA', green: '#167C32', violet: '#842FC7', amber: '#8B5800',
  cyan: '#007564', rose: '#B02571', orange: '#A34A00', coral: '#B53F38',
  sky: '#006BAD', magenta: '#9C219F',
} as const;

const dark: ThemePalette = {
  iconColor: '#B0B0B8',
  iconHoverColor: '#FFFFFF',
  focusRing: '#50C0FF',

  brandAnthropic: '#D97757',
  brandOpenai: '#10A37F',
  brandGemini: '#7FA8F5',
  brandDeepseek: '#7C88F8',
  chartBar: '#38BDF8',
  groupBlue: DARK_ACCENTS.blue,
  groupGreen: DARK_ACCENTS.green,
  groupViolet: DARK_ACCENTS.violet,
  groupAmber: DARK_ACCENTS.amber,
  groupCyan: DARK_ACCENTS.cyan,
  groupRose: DARK_ACCENTS.rose,
  groupOrange: DARK_ACCENTS.orange,
  shellZshAccent: '#F15A24',
  groupCoral: DARK_ACCENTS.coral,

  // Navigation keeps its tint while content and auxiliary panels retain separate levels.
  chromeBg: '#2E2E2E',
  sidebarBg: DARK_SURFACES.sidebar,
  auxiliaryBg: '#282828',
  chromeField: DARK_SURFACES.control,
  tabMenuBg: '#202020',
  selectionBg: '#484848',
  canvas: DARK_SURFACES.canvas,
  surface: DARK_SURFACES.card,
  cardBg: DARK_SURFACES.elevated,
  fieldBg: DARK_SURFACES.field,
  composerBg: '#333333',
  block: DARK_SURFACES.card,
  elevated: DARK_SURFACES.elevated,
  hover: 'rgba(255,255,255,0.07)',
  buttonHover: DARK_SURFACES.hover,

  border: DARK_SURFACES.border,
  borderStrong: DARK_SURFACES.borderStrong,
  resizeDivider: 'rgba(255,255,255,0.035)',
  inputBorder: 'rgba(255,255,255,0.08)',

  // Text
  textPrimary: '#EBEDF0',
  textSecondary: '#C9D0D6',
  textMuted: '#B5BDC6',

  // Blue accents distinguish active controls from descriptive text.
  accent: '#50C0FF',
  accentDim: 'rgba(80,192,255,0.16)',
  accentText: '#FFFFFF',

  // Interactive links share the active-control accent.
  accentBlue: '#50C0FF',
  accentBlueDim: 'rgba(80,192,255,0.14)',
  accentBlueStrong: '#91DBFF',

  accentWarm: '#D5AD54',
  accentWarmDim: 'rgba(213,173,84,0.14)',

  // User message surface
  accentUser: '#183C57',
  accentUserDim: 'rgba(24,60,87,0.35)',
  primaryAction: '#2C67C5',

  // Semantic colors remain independent from decorative accents.
  success: DARK_ACCENTS.green,
  successDim: 'rgba(48,209,88,0.15)',
  error: '#F14C4C',
  errorText: '#FFFFFF',
  dangerAction: '#FF5A52',
  dangerActionText: '#202020',
  errorDim: 'rgba(241,76,76,0.15)',
  errorLight: '#DF8A86',
  warning: '#D5AD54',

  blockCmdText: '#D4D4D4',
  blockCmdFailed: '#F48771',
  blockDivider: 'rgba(255,255,255,0.08)',

  // Vivid syntax colors share the command green's emphasis with readable contrast.
  cmdProgram: DARK_ACCENTS.green,
  cmdArgument: DARK_ACCENTS.blue,
  cmdNumber: DARK_ACCENTS.amber,
  cmdVariable: DARK_ACCENTS.magenta,
  cmdFlag: DARK_ACCENTS.sky,
  cmdPath: DARK_ACCENTS.cyan,
  cmdPipe: DARK_ACCENTS.violet,
  cmdRedirect: DARK_ACCENTS.violet,
  cmdString: DARK_ACCENTS.orange,

  searchHighlightBg: 'rgba(255,255,255,0.20)',

  shellConnected: DARK_ACCENTS.green,
  shellDisconnected: '#7A7A7A',

  overlay: 'rgba(0,0,0,0.55)',
  overlayLight: 'rgba(0,0,0,0.32)',
  shadowSm: '0 1px 3px rgba(0,0,0,0.45)',
  shadowMd: '0 4px 14px rgba(0,0,0,0.55)',
  shadowLg: '0 10px 30px rgba(0,0,0,0.65)',

  accentBg: 'rgba(255,255,255,0.06)',
  accentBgStrong: '#363636',
  successBg: 'rgba(48,209,88,0.12)',
  errorBg: 'rgba(241,76,76,0.12)',
  errorBadgeBg: 'rgba(241,76,76,0.08)',

  tuiBanner: '#BCBCBC',
  codeBg: DARK_SURFACES.field,
  commandBlockBg: DARK_SURFACES.card,
  aiBlockBg: DARK_SURFACES.card,
  failedBlockBg: '#301A1B',
  scrollbarThumb: 'rgba(255,255,255,0.12)',
  scrollbarThumbHover: 'rgba(255,255,255,0.2)',
  apiKeyBg: 'rgba(255,255,255,0.06)',
  apiKeyBorder: 'rgba(255,255,255,0.18)',

  xtermBg: DARK_SURFACES.content,
  xtermForeground: '#E9EBED',
  xtermCursor: '#E9EBED',
  textCaret: '#50C0FF',
  xtermSelection: 'rgba(141,183,232,0.28)',
  // Low-saturation ANSI palette: keeps directory, path and error semantics while avoiding color noise.
  xtermBlack: '#1B1F24',
  xtermRed: '#F28B82',
  xtermGreen: DARK_ACCENTS.green,
  xtermYellow: '#E6C98A',
  xtermBlue: '#8DB7E8',
  xtermMagenta: '#C5A4D8',
  xtermCyan: '#8FCFD0',
  xtermWhite: '#D6D9E0',
  xtermBrightBlack: '#66707C',
  xtermBrightRed: '#FF9A92',
  xtermBrightGreen: DARK_ACCENTS.green,
  xtermBrightYellow: '#F2DFA3',
  xtermBrightBlue: '#A9CCF5',
  xtermBrightMagenta: '#D7B7E8',
  xtermBrightCyan: '#B0E4E1',
  xtermBrightWhite: '#F3F5F8',
};

/**
 * Optional teal accent overrides for the custom theme configuration.
 * The built-in palette stays neutral; this preset adds colored accents.
 * Structural surfaces, brightness levels and shadows keep their defaults.
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
  '--shell-connected': '#30D158',
  '--block-cmd-text': '#D6DAE2',
  '--block-cmd-failed': '#F0928A',
  '--block-divider': 'rgba(255,255,255,0.07)',
};

// ── Light (neutral: the primary accent carries no hue) ──

const light: ThemePalette = {
  iconColor: '#454545',
  iconHoverColor: '#111111',
  focusRing: '#3478D1',

  // The same vendor hues carry over to the light palette; as marks (not body text) they stay distinguishable with enough contrast.
  brandAnthropic: '#C2643F',
  brandOpenai: '#0E8F71',
  brandGemini: '#4A7FE0',
  brandDeepseek: '#5A66E8',
  chartBar: '#0891B2',
  groupBlue: LIGHT_ACCENTS.blue,
  groupGreen: LIGHT_ACCENTS.green,
  groupViolet: LIGHT_ACCENTS.violet,
  groupAmber: LIGHT_ACCENTS.amber,
  groupCyan: LIGHT_ACCENTS.cyan,
  groupRose: LIGHT_ACCENTS.rose,
  groupOrange: LIGHT_ACCENTS.orange,
  shellZshAccent: '#F15A24',
  groupCoral: LIGHT_ACCENTS.coral,

  chromeBg: '#E9F0FA',
  sidebarBg: LIGHT_SURFACES.sidebar,
  auxiliaryBg: '#F0F2F3',
  chromeField: LIGHT_SURFACES.control,
  tabMenuBg: '#E6E6E6',
  selectionBg: '#FFFFFF',
  canvas: LIGHT_SURFACES.canvas,
  surface: LIGHT_SURFACES.card,
  cardBg: '#E7E9EB',
  fieldBg: LIGHT_SURFACES.field,
  composerBg: LIGHT_SURFACES.field,
  block: LIGHT_SURFACES.card,
  elevated: LIGHT_SURFACES.elevated,
  hover: 'rgba(0,0,0,0.05)',
  buttonHover: LIGHT_SURFACES.hover,

  border: LIGHT_SURFACES.border,
  borderStrong: LIGHT_SURFACES.borderStrong,
  resizeDivider: 'rgba(0,0,0,0.05)',
  inputBorder: '#DADADA',

  textPrimary: '#242B30',
  textSecondary: '#535F68',
  textMuted: '#59656F',

  // A darker neutral accent stays readable on light surfaces.
  accent: '#2864AE',
  accentDim: 'rgba(36,103,186,0.12)',
  accentText: '#FFFFFF',

  accentBlue: '#245FA5',
  accentBlueDim: 'rgba(36,103,186,0.12)',
  accentBlueStrong: '#174C91',

  accentWarm: '#865D1C',
  accentWarmDim: 'rgba(79,79,79,0.12)',

  accentUser: '#D9E4F7',
  accentUserDim: 'rgba(23,62,118,0.12)',
  primaryAction: '#2C67C5',

  success: LIGHT_ACCENTS.green,
  successDim: 'rgba(48,209,88,0.12)',
  error: '#A31515',
  errorText: '#FFFFFF',
  dangerAction: '#D92D20',
  dangerActionText: '#FFFFFF',
  errorDim: 'rgba(163,21,21,0.1)',
  errorLight: '#C94F4F',
  warning: '#795E26',

  blockCmdText: '#3B3B3B',
  blockCmdFailed: '#C94F4F',
  blockDivider: 'rgba(0,0,0,0.08)',

  cmdProgram: LIGHT_ACCENTS.green,
  cmdArgument: LIGHT_ACCENTS.blue,
  cmdNumber: LIGHT_ACCENTS.amber,
  cmdVariable: LIGHT_ACCENTS.magenta,
  cmdFlag: LIGHT_ACCENTS.sky,
  cmdPath: LIGHT_ACCENTS.cyan,
  cmdPipe: LIGHT_ACCENTS.violet,
  cmdRedirect: LIGHT_ACCENTS.violet,
  cmdString: LIGHT_ACCENTS.orange,

  searchHighlightBg: 'rgba(0,0,0,0.12)',

  shellConnected: LIGHT_ACCENTS.green,
  shellDisconnected: '#8C8C8C',

  overlay: 'rgba(0,0,0,0.15)',
  overlayLight: 'rgba(0,0,0,0.1)',
  shadowSm: '0 1px 3px rgba(0,0,0,0.10)',
  shadowMd: '0 4px 14px rgba(0,0,0,0.14)',
  shadowLg: '0 10px 30px rgba(0,0,0,0.18)',

  accentBg: 'rgba(46,46,46,0.06)',
  accentBgStrong: '#D8D8D8',
  successBg: 'rgba(48,209,88,0.08)',
  errorBg: 'rgba(163,21,21,0.07)',
  errorBadgeBg: 'rgba(163,21,21,0.05)',

  tuiBanner: '#4F4F4F',
  codeBg: LIGHT_SURFACES.field,
  commandBlockBg: LIGHT_SURFACES.card,
  aiBlockBg: LIGHT_SURFACES.card,
  failedBlockBg: '#F6E9E9',
  scrollbarThumb: 'rgba(0,0,0,0.18)',
  scrollbarThumbHover: 'rgba(0,0,0,0.3)',
  apiKeyBg: 'rgba(46,46,46,0.06)',
  apiKeyBorder: 'rgba(46,46,46,0.18)',

  xtermBg: LIGHT_SURFACES.content,
  xtermForeground: '#2B3038',
  xtermCursor: '#2E3742',
  textCaret: '#006FDB',
  xtermSelection: 'rgba(46,96,150,0.20)',
  xtermBlack: '#41454D',
  xtermRed: '#B42318',
  xtermGreen: LIGHT_ACCENTS.green,
  xtermYellow: '#8A6500',
  xtermBlue: '#2166A5',
  xtermMagenta: '#7A4E9B',
  xtermCyan: '#087F8C',
  xtermWhite: '#F3F4F6',
  xtermBrightBlack: '#6B7280',
  xtermBrightRed: '#D33A2C',
  xtermBrightGreen: LIGHT_ACCENTS.green,
  xtermBrightYellow: '#A47B00',
  xtermBrightBlue: '#2F7EC5',
  xtermBrightMagenta: '#9364B5',
  xtermBrightCyan: '#1499A5',
  xtermBrightWhite: '#FFFFFF',
};

// ── Exports ──

export type ThemeMode = 'dark' | 'light';

export const themes: Record<ThemeMode, ThemePalette> = { dark, light };

/** Stored appearance choice; 'system' follows the operating system. */
export type ThemePreference = ThemeMode | 'system';

const THEME_PREFERENCE_KEY = 'vrykell-theme-mode';

/** Reads the persisted appearance choice; defaults to 'dark'. */
export function readThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_PREFERENCE_KEY);
    if (stored === 'dark' || stored === 'light' || stored === 'system') return stored;
  } catch { /* storage unavailable */ }
  return 'dark';
}

export function persistThemePreference(preference: ThemePreference): void {
  try { localStorage.setItem(THEME_PREFERENCE_KEY, preference); } catch { /* storage unavailable */ }
}

/** Resolve a stored choice to the palette mode that should be applied. */
export function resolveThemeMode(preference: ThemePreference): ThemeMode {
  if (preference !== 'system') return preference;
  const prefersDark = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-color-scheme: dark)').matches;
  return prefersDark ? 'dark' : 'light';
}

/** Palette → CSS custom property mapping. */
export function paletteToCssVars(p: ThemePalette): Record<string, string> {
  return {
    '--icon-color': p.iconColor,
    '--icon-hover-color': p.iconHoverColor,
    '--focus-ring': p.focusRing,
    '--brand-anthropic': p.brandAnthropic,
    '--brand-openai': p.brandOpenai,
    '--brand-gemini': p.brandGemini,
    '--brand-deepseek': p.brandDeepseek,
    '--chart-bar': p.chartBar,
    '--group-blue': p.groupBlue,
    '--group-green': p.groupGreen,
    '--group-violet': p.groupViolet,
    '--group-amber': p.groupAmber,
    '--favorite-color': DARK_ACCENTS.amber,
    '--group-cyan': p.groupCyan,
    '--group-rose': p.groupRose,
    '--group-orange': p.groupOrange,
    '--shell-zsh-accent': p.shellZshAccent,
    '--group-coral': p.groupCoral,
    '--chrome-bg': p.chromeBg,
    '--sidebar-bg': p.sidebarBg,
    '--auxiliary-bg': p.auxiliaryBg,
    '--chrome-field': p.chromeField,
    '--tab-menu-bg': p.tabMenuBg,
    '--selection-bg': p.selectionBg,
    '--canvas': p.canvas,
    '--surface': p.surface,
    '--card-bg': p.cardBg,
    '--field-bg': p.fieldBg,
    '--composer-bg': p.composerBg,
    '--block': p.block,
    '--elevated': p.elevated,
    '--hover': p.hover,
    '--button-hover': p.buttonHover,
    '--border': p.border,
    '--border-strong': p.borderStrong,
    '--resize-divider': p.resizeDivider,
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
    '--primary-action': p.primaryAction,
    '--success': p.success,
    '--success-dim': p.successDim,
    '--error': p.error,
    '--error-text': p.errorText,
    '--danger-action': p.dangerAction,
    '--danger-action-text': p.dangerActionText,
    '--error-dim': p.errorDim,
    '--error-light': p.errorLight,
    '--warning': p.warning,
    '--block-cmd-text': p.blockCmdText,
    '--block-cmd-failed': p.blockCmdFailed,
    '--block-divider': p.blockDivider,
    '--cmd-program': p.cmdProgram,
    '--cmd-argument': p.cmdArgument,
    '--cmd-number': p.cmdNumber,
    '--cmd-variable': p.cmdVariable,
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
    '--command-block-bg': p.commandBlockBg,
    '--ai-block-bg': p.aiBlockBg,
    '--failed-block-bg': p.failedBlockBg,
    '--scrollbar-thumb': p.scrollbarThumb,
    '--scrollbar-thumb-hover': p.scrollbarThumbHover,
    '--api-key-bg': p.apiKeyBg,
    '--api-key-border': p.apiKeyBorder,
    '--xterm-bg': p.xtermBg,
    '--xterm-foreground': p.xtermForeground,
    '--xterm-cursor': p.xtermCursor,
    '--text-caret': p.textCaret,
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
    // Font and geometry variables stay unchanged (they are not managed by the palette)
  };
}

// ── User theme overrides (the `vars` of a terminal theme config, layered over the base palette) ──

let overrides: Record<string, string> = {};
let appliedOverrideKeys = new Set<string>();

/** Sets the CSS-variable override map (the `vars` of theme.json). An empty object means no overrides. */
export function setThemeOverrides(o: Record<string, string>): void {
  overrides = o ?? {};
}

/** Reads the current CSS-variable override map. */
export function getThemeOverrides(): Record<string, string> {
  return overrides;
}

/** Writes the palette (plus user overrides) to :root and marks data-theme. */
export function applyTheme(mode: ThemeMode): void {
  const base = paletteToCssVars(themes[mode]);
  const vars = { ...base, ...overrides };
  const root = document.documentElement;
  // Remove overrides absent from the new map, so the stylesheet inherits the current palette again.
  for (const key of appliedOverrideKeys) {
    if (!(key in vars)) root.style.removeProperty(key);
  }
  for (const [k, v] of Object.entries(vars)) {
    root.style.setProperty(k, v);
  }
  root.dataset.theme = mode;
  appliedOverrideKeys = new Set(Object.keys(overrides));
}

export function getCurrentTheme(): ThemeMode {
  return (document.documentElement.dataset.theme as ThemeMode) || 'dark';
}

/** Converts a #rgb / #rrggbb hex color to an rgba() string (alpha 0..1); falls back to black when parsing fails. */
export function hexToRgba(hex: string, alpha: number): string {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return `rgba(0, 0, 0, ${alpha})`;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Converts any color (hex / rgb() / rgba()) to rgba with the given alpha; other formats are returned unchanged. */
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
