import { useTypographyStore } from '@config/typography';
import { afterEach, describe, expect, it } from 'vitest';
import { cellHeightFromLineBox, getTerminalFontOptions, measureTerminalDomCellHeight, snapLetterSpacing } from '../terminalFont';

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

describe('terminal cell height', () => {
  it('truncates the line box the way the canvas sizes a row', () => {
    // Values measured against xterm's own cell height at the same font settings.
    expect(cellHeightFromLineBox(20, 1)).toBe(20);
    expect(cellHeightFromLineBox(20, 1.2)).toBe(24);
    expect(cellHeightFromLineBox(17, 1.4)).toBe(23);
    expect(cellHeightFromLineBox(26, 1.4)).toBe(36);
    expect(cellHeightFromLineBox(15, 1.2)).toBe(18);
  });

  it('ignores unusable measurements', () => {
    expect(cellHeightFromLineBox(0, 1)).toBe(0);
    expect(cellHeightFromLineBox(Number.NaN, 1)).toBe(0);
    expect(cellHeightFromLineBox(-4, 1)).toBe(0);
    expect(cellHeightFromLineBox(20, Number.NaN)).toBe(20);
  });

  it('publishes the measured row height for completed snapshots', () => {
    useTypographyStore.getState().update({ terminalFontSize: 16, terminalLineHeight: 1.4 });
    const published = document.documentElement.style.getPropertyValue('--terminal-row-height');
    expect(published).toBe(`${measureTerminalDomCellHeight()}px`);
    expect(Number.parseInt(published, 10)).toBeGreaterThan(0);
  });
});
