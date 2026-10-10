/** Map scroll offsets to an overlay thumb without reserving content width. */
export function scrollbarGeometry(viewport: number, extent: number, offset: number) {
  const maximum = Math.max(0, extent - viewport);
  const height = extent > 0 ? Math.min(viewport, Math.max(28, viewport * viewport / extent)) : 0;
  const travel = Math.max(0, viewport - height);
  const value = Math.max(0, Math.min(maximum, offset));
  return { maximum, height, travel, value, top: maximum > 0 ? travel * value / maximum : 0 };
}

export function scrollbarOffset(position: number, geometry: ReturnType<typeof scrollbarGeometry>) {
  return geometry.travel > 0
    ? Math.max(0, Math.min(geometry.maximum, position * geometry.maximum / geometry.travel))
    : 0;
}
