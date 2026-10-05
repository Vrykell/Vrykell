export interface MenuPosition {
  left: number;
  top: number;
}

/** Keep a floating menu inside the visible viewport while preserving its preferred anchor. */
export function clampMenuPosition(
  anchor: MenuPosition,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  margin = 8,
): MenuPosition {
  const maxLeft = Math.max(margin, viewport.width - size.width - margin);
  const maxTop = Math.max(margin, viewport.height - size.height - margin);

  return {
    left: Math.max(margin, Math.min(anchor.left, maxLeft)),
    top: Math.max(margin, Math.min(anchor.top, maxTop)),
  };
}
