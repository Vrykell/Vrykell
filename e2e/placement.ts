import type { Locator, Page } from '@playwright/test';

export type PlacementSide = 'left' | 'right' | 'top' | 'bottom';

/** Half-screen drop point offsets relative to the pane center: the four sides map to the four splittable halves, and the vertical points sit deeper so top/bottom are distinguishable from left/right. */
const SIDE_OFFSETS: Record<PlacementSide, [number, number]> = {
  left: [0.25, 0.5],
  right: [0.75, 0.5],
  top: [0.5, 0.2],
  bottom: [0.5, 0.8],
};

/** The pane that currently has focus. */
export function focusedPane(page: Page): Locator {
  return page.locator('.terminal-pane[data-focused="true"]:visible').first();
}

/** Hover the half-screen drop point on one side of a pane and return the hover coordinates; the preview renders only at that drop point. */
export async function hoverPlacementZone(page: Page, pane: Locator, side: PlacementSide): Promise<{ x: number; y: number }> {
  const box = await pane.boundingBox();
  if (!box) throw new Error('placement anchor pane is not visible');
  const [fx, fy] = SIDE_OFFSETS[side];
  const x = box.x + box.width * fx;
  const y = box.y + box.height * fy;
  await page.mouse.move(x, y);
  return { x, y };
}

/** Hover a drop point preview, then click to confirm (splitting and re-placing both commit on click). */
export async function pickPlacementZone(page: Page, pane: Locator, side: PlacementSide): Promise<void> {
  const { x, y } = await hoverPlacementZone(page, pane, side);
  await page.mouse.click(x, y);
}
