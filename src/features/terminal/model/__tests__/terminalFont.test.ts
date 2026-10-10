import { useTypographyStore } from '@config/typography';
import { afterEach, describe, expect, it } from 'vitest';
import { getTerminalFontOptions, snapLetterSpacing } from '../terminalFont';

describe('terminal cell width snapping', () => {
  it('absorbs the fractional part of the measured advance', () => {
    expect(snapLetterSpacing(8.4)).toBeCloseTo(-0.4, 5);
    expect(snapLetterSpacing(7.6)).toBeCloseTo(0.4, 5);
    expect(snapLetterSpacing(8)).toBe(0);
    // A rounding artifact far below a pixel must not add tracking.
    expect(snapLetterSpacing(9.001)).toBe(0);
  });

  it('ignores unusable measurements', () => {
    expect(snapLetterSpacing(0)).toBe(0);
    expect(snapLetterSpacing(Number.NaN)).toBe(0);
    expect(snapLetterSpacing(-3)).toBe(0);
  });
});

afterEach(() => useTypographyStore.getState().reset());
it('uses matching font preferences for terminal output and cell measurements', () => {
  useTypographyStore.getState().update({ terminalFontPreset: 'Maple Mono NF CN', terminalFontWeight: 350, terminalLineHeight: 1.2 });
  const options = getTerminalFontOptions();
  expect(options.fontFamily).toMatch(/^"Maple Mono NF CN",/);
  expect(options).toMatchObject({ fontWeight: 350, fontWeightBold: 700, fontSize: 14, lineHeight: 1.2 });
  expect(options.fontFamily.indexOf('Noto Sans Mono CJK SC')).toBeLessThan(options.fontFamily.indexOf('monospace'));
  expect(document.querySelector('span')).toBeNull();
});
