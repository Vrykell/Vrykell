import type { ThemeMode, ThemePalette } from './tokens';

type Colors = readonly [string, string, string, string, string, string, string, string];
interface Seed {
  background: string;
  foreground: string;
  colors: Colors;
  orange: string;
}
export interface ThemePreset {
  id: string;
  name: string;
  mode: ThemeMode;
  seed?: Seed;
}

/** Published palette values only; application roles are mapped independently below. */
export const themePresets: readonly ThemePreset[] = [
  { id: 'default-dark', name: 'Default dark', mode: 'dark' },
  { id: 'dracula', name: 'Dracula', mode: 'dark', seed: {
    background: '#282A36', foreground: '#F8F8F2', orange: '#FFB86C',
    colors: ['#21222C', '#FF5555', '#50FA7B', '#F1FA8C', '#BD93F9', '#FF79C6', '#8BE9FD', '#F8F8F2'],
  } },
  { id: 'nord-dark', name: 'Nord', mode: 'dark', seed: {
    background: '#2E3440', foreground: '#ECEFF4', orange: '#D08770',
    colors: ['#3B4252', '#BF616A', '#A3BE8C', '#EBCB8B', '#81A1C1', '#B48EAD', '#88C0D0', '#E5E9F0'],
  } },
  { id: 'solarized-dark', name: 'Solarized dark', mode: 'dark', seed: {
    background: '#002B36', foreground: '#93A1A1', orange: '#CB4B16',
    colors: ['#073642', '#DC322F', '#859900', '#B58900', '#268BD2', '#D33682', '#2AA198', '#EEE8D5'],
  } },
  { id: 'catppuccin-mocha', name: 'Catppuccin Mocha', mode: 'dark', seed: {
    background: '#1E1E2E', foreground: '#CDD6F4', orange: '#FAB387',
    colors: ['#45475A', '#F38BA8', '#A6E3A1', '#F9E2AF', '#89B4FA', '#CBA6F7', '#94E2D5', '#BAC2DE'],
  } },
  { id: 'default-light', name: 'Default light', mode: 'light' },
  { id: 'alucard', name: 'Alucard', mode: 'light', seed: {
    background: '#FFFBEB', foreground: '#1F1F1F', orange: '#A34D14',
    colors: ['#FFFBEB', '#CB3A2A', '#14710A', '#846E15', '#644AC9', '#A3144D', '#036A96', '#1F1F1F'],
  } },
  { id: 'nord-light', name: 'Nord light', mode: 'light', seed: {
    background: '#ECEFF4', foreground: '#2E3440', orange: '#D08770',
    colors: ['#3B4252', '#BF616A', '#A3BE8C', '#EBCB8B', '#5E81AC', '#B48EAD', '#8FBCBB', '#E5E9F0'],
  } },
  { id: 'solarized-light', name: 'Solarized light', mode: 'light', seed: {
    background: '#FDF6E3', foreground: '#586E75', orange: '#CB4B16',
    colors: ['#073642', '#DC322F', '#859900', '#B58900', '#268BD2', '#D33682', '#2AA198', '#EEE8D5'],
  } },
  { id: 'catppuccin-latte', name: 'Catppuccin Latte', mode: 'light', seed: {
    background: '#EFF1F5', foreground: '#4C4F69', orange: '#FE640B',
    colors: ['#5C5F77', '#D20F39', '#40A02B', '#DF8E1D', '#1E66F5', '#8839EF', '#179299', '#ACB0BE'],
  } },
];

export function resolveThemePreset(mode: ThemeMode, id?: string): ThemePreset {
  return themePresets.find(preset => preset.mode === mode && preset.id === id)
    ?? themePresets.find(preset => preset.id === `default-${mode}`)!;
}

const channels = (hex: string) => [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16));
function blend(a: string, b: string, amount: number): string {
  const target = channels(b);
  return '#' + channels(a).map((value, index) => Math.round(value + (target[index] - value) * amount)
    .toString(16).padStart(2, '0')).join('');
}
function luminance(hex: string): number {
  const linear = channels(hex).map(value => value / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}
export function contrast(a: string, b: string): number {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}
const alpha = (hex: string, opacity: number) => `rgba(${channels(hex).join(', ')}, ${opacity})`;

function fitContrast(color: string, background: string, ink: string, minimum = 4.5): string {
  for (let step = 0; step <= 20; step++) {
    const candidate = blend(color, ink, step / 20);
    if (contrast(candidate, background) >= minimum) return candidate;
  }
  return ink;
}

/** Keep original defaults byte-for-byte; derive every structural role for additional presets. */
export function presetPalette(base: ThemePalette, preset: ThemePreset): ThemePalette {
  if (!preset.seed) return base;
  const { background: bg, foreground, colors: c, orange } = preset.seed;
  const light = preset.mode === 'light';
  const fg = light ? fitContrast(foreground, bg, '#111827', 7) : foreground;
  // Bright palettes need stronger layer separation and ink, rather than inverted dark ratios.
  const surface = blend(bg, fg, light ? 0.09 : 0.035);
  const raised = light ? blend(bg, '#FFFFFF', 0.85) : blend(bg, fg, 0.075);
  const hover = blend(bg, fg, light ? 0.18 : 0.12);
  const border = blend(bg, fg, light ? 0.32 : 0.19);
  const readable = (color: string) => fitContrast(color, light ? hover : raised, fg);
  const muted = light ? readable(blend(bg, fg, 0.76)) : blend(bg, fg, 0.76);
  const terminal = light ? c.map(color => fitContrast(color, bg, fg)) : c;
  const [red, green, yellow, blue, violet, cyan] = [c[1], c[2], c[3], c[4], c[5], c[6]].map(readable);
  const onAccent = contrast(bg, blue) > contrast(fg, blue) ? bg : fg;
  const onDanger = contrast(bg, red) > contrast(fg, red) ? bg : fg;
  const selection = alpha(blue, 0.25);
  const dim = (color: string) => alpha(color, 0.12);
  return {
    ...base,
    iconColor: muted, iconHoverColor: fg, focusRing: blue, chartBar: blue,
    groupBlue: blue, groupGreen: green, groupViolet: violet, groupAmber: yellow,
    groupCyan: cyan, groupRose: violet, groupOrange: readable(orange), groupCoral: red,
    chromeBg: surface, sidebarBg: surface, auxiliaryBg: surface, chromeField: raised,
    tabMenuBg: raised, selectionBg: selection,
    segmentedTrack: preset.mode === 'dark' ? blend(bg, fg, 0.10) : blend(bg, fg, 0.25),
    segmentedThumb: preset.mode === 'dark' ? blend(bg, fg, 0.32) : bg,
    segmentedText: preset.mode === 'dark' ? base.xtermBrightWhite : fg,
    canvas: bg, surface, cardBg: surface,
    fieldBg: raised, composerBg: raised, block: bg, elevated: raised, hover, buttonHover: hover,
    border, borderStrong: blend(bg, fg, light ? 0.46 : 0.35),
    resizeDivider: alpha(fg, light ? 0.08 : 0.06), inputBorder: border,
    textPrimary: fg, textSecondary: light ? readable(blend(bg, fg, 0.9)) : blend(bg, fg, 0.9), textMuted: muted,
    accent: blue, accentDim: dim(blue), accentText: onAccent,
    accentBlue: blue, accentBlueDim: dim(blue), accentBlueStrong: blue,
    accentWarm: yellow, accentWarmDim: dim(yellow), accentUser: violet, accentUserDim: dim(violet),
    primaryAction: blue, primaryActionText: onAccent,
    primaryActionHover: blend(blue, contrast(onAccent, '#FFFFFF') > contrast(onAccent, '#000000') ? '#FFFFFF' : '#000000', 0.12),
    success: green, successDim: dim(green), error: red, errorText: red,
    dangerAction: red, dangerActionText: onDanger, errorDim: dim(red), errorLight: red, warning: yellow,
    blockCmdText: fg, blockCmdFailed: red, blockDivider: border,
    cmdProgram: green, cmdArgument: fg, cmdNumber: readable(orange), cmdVariable: violet,
    cmdFlag: violet, cmdPath: cyan, cmdPipe: muted, cmdRedirect: yellow, cmdString: yellow,
    searchHighlightBg: alpha(yellow, 0.22), shellConnected: green, shellDisconnected: muted,
    accentBg: dim(blue), accentBgStrong: alpha(blue, 0.2), successBg: dim(green), errorBg: dim(red), errorBadgeBg: dim(red),
    tuiBanner: raised, codeBg: bg, commandBlockBg: bg, aiBlockBg: bg, failedBlockBg: dim(red),
    scrollbarThumb: alpha(fg, 0.18), scrollbarThumbHover: alpha(fg, 0.28), apiKeyBg: raised, apiKeyBorder: border,
    xtermBg: bg, xtermForeground: fg, xtermCursor: fg, textCaret: blue, xtermSelection: selection,
    xtermBlack: light ? fg : c[0], xtermRed: terminal[1], xtermGreen: terminal[2], xtermYellow: terminal[3],
    xtermBlue: terminal[4], xtermMagenta: terminal[5], xtermCyan: terminal[6], xtermWhite: terminal[7],
    xtermBrightBlack: muted, xtermBrightRed: terminal[1], xtermBrightGreen: terminal[2], xtermBrightYellow: terminal[3],
    xtermBrightBlue: terminal[4], xtermBrightMagenta: terminal[5], xtermBrightCyan: terminal[6], xtermBrightWhite: fg,
  };
}
