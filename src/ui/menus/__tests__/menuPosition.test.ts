import { describe, expect, it } from 'vitest';
import { clampMenuPosition } from '@ui/menus/menuPosition';

describe('clampMenuPosition', () => {
  it('keeps a menu anchored near the lower-right corner inside the viewport', () => {
    expect(clampMenuPosition(
      { left: 390, top: 290 },
      { width: 180, height: 100 },
      { width: 400, height: 320 },
    )).toEqual({ left: 212, top: 212 });
  });

  it('uses the viewport margin when the menu is larger than the available space', () => {
    expect(clampMenuPosition(
      { left: 0, top: 0 },
      { width: 500, height: 500 },
      { width: 320, height: 240 },
    )).toEqual({ left: 8, top: 8 });
  });
});
