import { describe, expect, it } from 'vitest';
import { indexToCss, PALETTE } from '@features/terminal/model/blockTypes';

describe('terminal block palette', () => {
  it('ANSI 16 色使用终端主题变量', () => {
    expect(PALETTE[1]).toBe('var(--xterm-red, #F28B82)');
    expect(PALETTE[4]).toBe('var(--xterm-blue, #8DB7E8)');
    expect(PALETTE[15]).toBe('var(--xterm-bright-white, #F3F5F8)');
  });

  it('默认前景、背景和光标映射到同一套终端变量', () => {
    expect(indexToCss(256)).toBe('var(--xterm-foreground, #D6D9E0)');
    expect(indexToCss(257)).toBe('var(--xterm-bg, #111417)');
    expect(indexToCss(258)).toBe('var(--xterm-cursor, #C9D1DB)');
  });
});
