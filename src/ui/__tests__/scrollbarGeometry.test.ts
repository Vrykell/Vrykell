import { describe, expect, it } from 'vitest';
import { scrollbarGeometry, scrollbarOffset } from '../scrollbarGeometry';

describe('overlay scrollbar geometry', () => {
  it('maps both ends and the midpoint without reserving a gutter', () => {
    const geometry = scrollbarGeometry(400, 2000, 800);
    expect(geometry).toEqual({ maximum: 1600, height: 80, travel: 320, value: 800, top: 160 });
    expect(scrollbarOffset(0, geometry)).toBe(0);
    expect(scrollbarOffset(160, geometry)).toBe(800);
    expect(scrollbarOffset(320, geometry)).toBe(1600);
  });

  it('retains a usable thumb for very long history and clamps dragging outside the track', () => {
    const geometry = scrollbarGeometry(400, 40000, 50000);
    expect(geometry.height).toBe(28);
    expect(geometry.value).toBe(39600);
    expect(scrollbarOffset(-100, geometry)).toBe(0);
    expect(scrollbarOffset(1000, geometry)).toBe(39600);
  });

  it('handles empty, fitting and temporarily hidden surfaces', () => {
    for (const [viewport, extent] of [[400, 0], [400, 200], [0, 0]]) {
      const geometry = scrollbarGeometry(viewport, extent, -20);
      expect(geometry.maximum).toBe(0);
      expect(geometry.top).toBe(0);
      expect(scrollbarOffset(50, geometry)).toBe(0);
      expect(Number.isFinite(geometry.height)).toBe(true);
    }
  });
});
