import { expect, it } from 'vitest';
import { globalSearchLayout, titlebarHistoryFits, TITLEBAR_HISTORY_MIN_TITLE, TITLEBAR_HISTORY_WIDTH } from '../model/titlebarLayout';

it.each([0, 208, 320])('centers search in the entire application with a %s pixel sidebar', headerLeft => {
  const layout = globalSearchLayout({ viewportWidth: 1240, headerLeft, headerWidth: 1240 - headerLeft, actionsWidth: 300, leftReserved: 20 });
  expect(headerLeft + layout.titleSpace + layout.gap + layout.width / 2).toBe(620);
  expect(layout.width).toBeLessThanOrEqual(420);
  expect(layout.titleSpace + layout.width + 2 * layout.gap + 300).toBeLessThanOrEqual(1240 - headerLeft);
});

it('shrinks the field before fixed controls and retains the expansion button in a narrow window', () => {
  const layout = globalSearchLayout({ viewportWidth: 500, headerLeft: 0, headerWidth: 500, actionsWidth: 220, leftReserved: 56 });
  expect(layout.width).toBeGreaterThanOrEqual(32);
  expect(layout.titleSpace).toBeGreaterThanOrEqual(56);
  expect(layout.titleSpace + layout.gap + layout.width).toBeLessThanOrEqual(280);
  expect(layout.titleSpace + layout.gap + layout.width / 2).toBe(250);
});

it('keeps the history actions while the title and search retain a readable share', () => {
  expect(titlebarHistoryFits({ titleSpace: 190, titleReserved: 20, searchWidth: 420 })).toBe(true);
  // A squeezed title folds the actions before the label truncates.
  expect(titlebarHistoryFits({ titleSpace: 100, titleReserved: 20, searchWidth: 340 })).toBe(false);
  // Once the search has collapsed to its icon, the bar has no room for extra controls.
  expect(titlebarHistoryFits({ titleSpace: 260, titleReserved: 20, searchWidth: 48 })).toBe(false);
  expect(TITLEBAR_HISTORY_WIDTH).toBeGreaterThan(TITLEBAR_HISTORY_MIN_TITLE / 2);
});
