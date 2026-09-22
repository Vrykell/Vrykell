import { describe, expect, it, beforeEach } from 'vitest';
import { readXtermTheme } from '@features/terminal/model/xtermTheme';

beforeEach(() => {
  document.documentElement.removeAttribute('style');
});

describe('readXtermTheme', () => {
  it('读取终端背景、前景和 ANSI 颜色变量', () => {
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

  it('缺少变量时使用可读的深色终端回退值', () => {
    const theme = readXtermTheme();
    expect(theme.background).toBe('#111417');
    expect(theme.foreground).toBe('#D6D9E0');
    expect(theme.blue).toBe('#8DB7E8');
    expect(theme.brightWhite).toBe('#F3F5F8');
  });
});
