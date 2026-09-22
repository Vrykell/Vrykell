/**
 * 从 CSS 主题变量读取 xterm.js 主题。
 *
 * 主终端、运行中块终端和主题热更新必须共用同一套颜色，避免同一条命令
 * 在不同渲染场景中出现背景或 ANSI 颜色跳变。
 */
export interface XtermTheme {
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

const FALLBACKS: XtermTheme = {
  background: '#111417',
  foreground: '#D6D9E0',
  cursor: '#C9D1DB',
  selectionBackground: 'rgba(141,183,232,0.28)',
  black: '#1B1F24',
  red: '#F28B82',
  green: '#A8D5A2',
  yellow: '#E6C98A',
  blue: '#8DB7E8',
  magenta: '#C5A4D8',
  cyan: '#8FCFD0',
  white: '#D6D9E0',
  brightBlack: '#66707C',
  brightRed: '#FF9A92',
  brightGreen: '#BFE8B7',
  brightYellow: '#F2DFA3',
  brightBlue: '#A9CCF5',
  brightMagenta: '#D7B7E8',
  brightCyan: '#B0E4E1',
  brightWhite: '#F3F5F8',
};

function cssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

export function readXtermTheme(): XtermTheme {
  return {
    background: cssVar('--xterm-bg', FALLBACKS.background),
    foreground: cssVar('--xterm-foreground', FALLBACKS.foreground),
    cursor: cssVar('--xterm-cursor', FALLBACKS.cursor),
    selectionBackground: cssVar('--xterm-selection', FALLBACKS.selectionBackground),
    black: cssVar('--xterm-black', FALLBACKS.black),
    red: cssVar('--xterm-red', FALLBACKS.red),
    green: cssVar('--xterm-green', FALLBACKS.green),
    yellow: cssVar('--xterm-yellow', FALLBACKS.yellow),
    blue: cssVar('--xterm-blue', FALLBACKS.blue),
    magenta: cssVar('--xterm-magenta', FALLBACKS.magenta),
    cyan: cssVar('--xterm-cyan', FALLBACKS.cyan),
    white: cssVar('--xterm-white', FALLBACKS.white),
    brightBlack: cssVar('--xterm-bright-black', FALLBACKS.brightBlack),
    brightRed: cssVar('--xterm-bright-red', FALLBACKS.brightRed),
    brightGreen: cssVar('--xterm-bright-green', FALLBACKS.brightGreen),
    brightYellow: cssVar('--xterm-bright-yellow', FALLBACKS.brightYellow),
    brightBlue: cssVar('--xterm-bright-blue', FALLBACKS.brightBlue),
    brightMagenta: cssVar('--xterm-bright-magenta', FALLBACKS.brightMagenta),
    brightCyan: cssVar('--xterm-bright-cyan', FALLBACKS.brightCyan),
    brightWhite: cssVar('--xterm-bright-white', FALLBACKS.brightWhite),
  };
}
