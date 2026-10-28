import { describe, expect, it } from 'vitest';
import { indexToCss, PALETTE } from '@features/terminal/model/blockTypes';

describe('terminal block palette', () => {
  it('uses terminal theme variables for the ANSI 16 colors', () => {
    expect(PALETTE[1]).toBe('var(--xterm-red, #F28B82)');
    expect(PALETTE[4]).toBe('var(--xterm-blue, #8DB7E8)');
    expect(PALETTE[15]).toBe('var(--xterm-bright-white, #F3F5F8)');
  });

  it('maps the default foreground, background and cursor to the same terminal variables', () => {
    expect(indexToCss(256)).toBe('var(--xterm-foreground, #E9EBED)');
    expect(indexToCss(257)).toBe('var(--xterm-bg, #141414)');
    expect(indexToCss(258)).toBe('var(--xterm-cursor, #E9EBED)');
  });
});
