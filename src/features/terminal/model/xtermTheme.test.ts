import { describe, expect, it, beforeEach } from 'vitest';
import { readXtermTheme } from '@features/terminal/model/xtermTheme';
import { themes } from '@config/theme/tokens';

beforeEach(() => {
  document.documentElement.removeAttribute('style');
});

describe('readXtermTheme', () => {
  it('uses the terminal cursor token independently of the blue native text caret', () => {
    document.documentElement.style.setProperty('--xterm-cursor', '#ECEFF4');
    document.documentElement.style.setProperty('--text-caret', '#4DA3FF');
    expect(readXtermTheme().cursor).toBe('#ECEFF4');
  });
  it('reads the terminal background, foreground and ANSI color variables', () => {
    document.documentElement.style.setProperty('--xterm-bg', '#121820');
    document.documentElement.style.setProperty('--xterm-foreground', '#DDE4EE');
    document.documentElement.style.setProperty('--xterm-blue', '#8DB7E8');
    document.documentElement.style.setProperty('--xterm-bright-red', '#FF9A92');

    const theme = readXtermTheme();
    expect(theme.background).toBe('#121820');
    expect(theme.foreground).toBe('#DDE4EE');
    expect(theme.blue).toBe('#8DB7E8');
    expect(theme.brightRed).toBe('#FF9A92');
  });

  it('uses the shared palette when CSS variables are unavailable', () => {
    const theme = readXtermTheme();
    expect(theme.background).toBe(themes.dark.xtermBg);
    expect(theme.foreground).toBe(themes.dark.xtermForeground);
    expect(theme.cursor).toBe(themes.dark.xtermCursor);
    expect(theme.blue).toBe(themes.dark.xtermBlue);
    expect(theme.brightWhite).toBe(themes.dark.xtermBrightWhite);
    expect(theme.scrollbarSliderBackground).toBe(themes.dark.scrollbarThumb);
  });
});
