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
