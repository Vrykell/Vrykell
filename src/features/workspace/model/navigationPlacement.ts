/** Preview bounds are also the full release target; neither uses an extra edge threshold. */
export function panelPlacementRects(body: Pick<DOMRect, 'left' | 'right' | 'top' | 'width' | 'height'>, panelWidth: number) {
  const width = Math.max(0, Math.min(panelWidth, body.width / 3));
  return {
    left: { left: body.left, top: body.top, width, height: body.height },
    right: { left: body.right - width, top: body.top, width, height: body.height },
  };
}
