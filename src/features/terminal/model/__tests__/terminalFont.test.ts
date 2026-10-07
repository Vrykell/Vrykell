import { describe, expect, it } from 'vitest';
import { snapLetterSpacing } from '../terminalFont';

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
