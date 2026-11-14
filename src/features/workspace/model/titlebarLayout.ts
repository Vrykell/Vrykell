/** Center the global search in the application while preserving fixed controls on either side. */
export function globalSearchLayout({ viewportWidth, headerLeft, headerWidth, actionsWidth, leftReserved, gap = 12 }: {
  viewportWidth: number; headerLeft: number; headerWidth: number; actionsWidth: number; leftReserved: number; gap?: number;
}) {
  const center = viewportWidth / 2 - headerLeft;
  const leftRoom = Math.max(0, center - leftReserved);
  const rightRoom = Math.max(0, headerWidth - actionsWidth - center);
  const spacing = Math.max(0, Math.min(gap, leftRoom - 16, rightRoom - 16));
  const width = Math.max(32, Math.min(420, viewportWidth * .34, 2 * (leftRoom - spacing), 2 * (rightRoom - spacing)));
  return { width, gap: spacing, titleSpace: Math.max(0, center - width / 2 - spacing) };
}

/** Two compact targets, their gap and the pull toward the search field, as the column renders them. */
export const TITLEBAR_HISTORY_WIDTH = 60;
/** A title never shrinks below roughly four characters just to keep the history actions visible. */
export const TITLEBAR_HISTORY_MIN_TITLE = 56;
/** Below this the search field has already collapsed to its icon, so the bar is out of room. */
export const TITLEBAR_SEARCH_MIN_WIDTH = 112;

/**
 * The title column holds the label and, at its right edge, the back and forward actions.
 * They fold away as soon as the label would be squeezed or the search field has given up its
 * text, so the title keeps a readable share and the search never becomes an icon-only stub.
 */
export function titlebarHistoryFits({ titleSpace, titleReserved, searchWidth }: { titleSpace: number; titleReserved: number; searchWidth: number }) {
  return searchWidth >= TITLEBAR_SEARCH_MIN_WIDTH
    && titleSpace - titleReserved >= TITLEBAR_HISTORY_WIDTH + TITLEBAR_HISTORY_MIN_TITLE;
}
