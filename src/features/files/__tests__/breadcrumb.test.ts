import { describe, it, expect } from 'vitest';
import { compactPathSegments } from '@features/files/utils/breadcrumb';
import { segmentsToPath } from '@platform/path';

describe('compactPathSegments', () => {
  it('短路径全部保留', () => {
    const segs = ['Users', 'wuzhe'];
    const { visible, hiddenCount } = compactPathSegments(segs, segmentsToPath);
    expect(visible.map((c) => c.seg)).toEqual(['Users', 'wuzhe']);
    expect(visible[1]!.full).toBe('/Users/wuzhe');
    expect(hiddenCount).toBe(0);
  });

  it('超长路径省略高层级目录', () => {
    const segs = ['Users', 'wuzhe', 'Documents', 'projects', 'Vrykell', 'src'];
    const { visible, hiddenCount } = compactPathSegments(segs, segmentsToPath, 16);
    // 只保留最深层级：src、Vrykell（从深往前累计 ≤ 16 字符；projects 放不下）
    expect(visible.map((c) => c.seg)).toEqual(['Vrykell', 'src']);
    // 每个可见段仍指向完整路径（点击导航正确）
    expect(visible[1]!.full).toBe('/Users/wuzhe/Documents/projects/Vrykell/src');
    expect(hiddenCount).toBe(4);
  });

  it('单个长段也保留（无法再省略）', () => {
    const segs = ['a-very-long-directory-name-that-exceeds-capacity'];
    const { visible, hiddenCount } = compactPathSegments(segs, segmentsToPath, 5);
    expect(visible).toHaveLength(1);
    expect(hiddenCount).toBe(0);
  });
});
