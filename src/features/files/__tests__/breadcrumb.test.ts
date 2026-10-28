import { describe, it, expect } from 'vitest';
import { compactPathSegments } from '@features/files/utils/breadcrumb';
import { segmentsToPath } from '@platform/path';

describe('compactPathSegments', () => {
  it('keeps every segment of a short path', () => {
    const segs = ['Users', 'wuzhe'];
    const { visible, hiddenCount } = compactPathSegments(segs, segmentsToPath);
    expect(visible.map((c) => c.seg)).toEqual(['Users', 'wuzhe']);
    expect(visible[1]!.full).toBe('/Users/wuzhe');
    expect(hiddenCount).toBe(0);
  });

  it('omits higher-level directories for a very long path', () => {
    const segs = ['Users', 'wuzhe', 'Documents', 'projects', 'Vrykell', 'src'];
    const { visible, hiddenCount } = compactPathSegments(segs, segmentsToPath, 16);
    // Keep only the deepest levels: src and Vrykell (accumulating from the deepest stays ≤ 16 characters; projects does not fit)
    expect(visible.map((c) => c.seg)).toEqual(['Vrykell', 'src']);
    // Every visible segment still points at the full path (click navigation stays correct)
    expect(visible[1]!.full).toBe('/Users/wuzhe/Documents/projects/Vrykell/src');
    expect(hiddenCount).toBe(4);
  });

  it('keeps a single long segment (nothing left to omit)', () => {
    const segs = ['a-very-long-directory-name-that-exceeds-capacity'];
    const { visible, hiddenCount } = compactPathSegments(segs, segmentsToPath, 5);
    expect(visible).toHaveLength(1);
    expect(hiddenCount).toBe(0);
  });
});
