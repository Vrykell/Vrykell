/** Read the shared terminal palette for live output, completed blocks and theme updates. */
import type { ITheme } from '@xterm/xterm';
import { paletteToCssVars, themes } from '@config/theme/tokens';

export interface XtermTheme extends ITheme {
  background: string;
  foreground: string;
  cursor: string;
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

const DEFAULT_VARS = paletteToCssVars(themes.dark);

function cssVar(name: string): string {
  const fallback = DEFAULT_VARS[name] ?? '';
  if (typeof document === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

export function readXtermTheme(): XtermTheme {
  return {
    background: cssVar('--xterm-bg'),
    foreground: cssVar('--xterm-foreground'),
    cursor: cssVar('--xterm-cursor'),
    selectionBackground: cssVar('--xterm-selection'),
    scrollbarSliderBackground: cssVar('--scrollbar-thumb'),
    scrollbarSliderHoverBackground: cssVar('--scrollbar-thumb-hover'),
    scrollbarSliderActiveBackground: cssVar('--scrollbar-thumb-hover'),
    // Keep the ruler's outline blended into the terminal background.
    overviewRulerBorder: cssVar('--xterm-bg'),
    black: cssVar('--xterm-black'),
    red: cssVar('--xterm-red'),
    green: cssVar('--xterm-green'),
    yellow: cssVar('--xterm-yellow'),
    blue: cssVar('--xterm-blue'),
    magenta: cssVar('--xterm-magenta'),
    cyan: cssVar('--xterm-cyan'),
    white: cssVar('--xterm-white'),
    brightBlack: cssVar('--xterm-bright-black'),
    brightRed: cssVar('--xterm-bright-red'),
    brightGreen: cssVar('--xterm-bright-green'),
    brightYellow: cssVar('--xterm-bright-yellow'),
    brightBlue: cssVar('--xterm-bright-blue'),
    brightMagenta: cssVar('--xterm-bright-magenta'),
    brightCyan: cssVar('--xterm-bright-cyan'),
    brightWhite: cssVar('--xterm-bright-white'),
  };
}
