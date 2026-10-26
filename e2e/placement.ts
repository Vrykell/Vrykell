import type { Locator, Page } from '@playwright/test';

export type PlacementSide = 'left' | 'right' | 'top' | 'bottom';

/** 半屏落点相对窗格中心的比例：四边对应四个可分裂的半屏，纵向取深一点以便区分上下与左右落点。 */
const SIDE_OFFSETS: Record<PlacementSide, [number, number]> = {
  left: [0.25, 0.5],
  right: [0.75, 0.5],
  top: [0.5, 0.2],
  bottom: [0.5, 0.8],
};

/** 当前获得焦点的窗格。 */
export function focusedPane(page: Page): Locator {
  return page.locator('.terminal-pane[data-focused="true"]:visible').first();
}

/** 悬停某个窗格一侧的半屏落点，返回悬停坐标；预览只在该落点渲染。 */
export async function hoverPlacementZone(page: Page, pane: Locator, side: PlacementSide): Promise<{ x: number; y: number }> {
  const box = await pane.boundingBox();
  if (!box) throw new Error('placement anchor pane is not visible');
  const [fx, fy] = SIDE_OFFSETS[side];
  const x = box.x + box.width * fx;
  const y = box.y + box.height * fy;
  await page.mouse.move(x, y);
  return { x, y };
}

/** 悬停落点预览后点击确认（分裂/更换位置都是点击提交）。 */
export async function pickPlacementZone(page: Page, pane: Locator, side: PlacementSide): Promise<void> {
  const { x, y } = await hoverPlacementZone(page, pane, side);
  await page.mouse.click(x, y);
}
