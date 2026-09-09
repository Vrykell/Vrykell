import { describe, expect, it } from 'vitest';
import {
  compactPathSegments,
  isDriveRoot,
  normPath,
  parentOf,
  pathSegments,
  segmentsToPath,
} from '@/features/files/services/pathUtils';

describe('pathUtils', () => {
  it('normPath 归一化反斜杠并去尾斜杠', () => {
    expect(normPath('C:\\Users\\foo\\')).toBe('C:/Users/foo');
    expect(normPath('C:\\')).toBe('C:');
    expect(normPath('/Users/foo')).toBe('/Users/foo');
    // OSC 7 的 Windows 盘符形式 → 盘符
    expect(normPath('/C:/Users/foo')).toBe('C:/Users/foo');
  });

  it('normPath 保留文件系统根（cd / 后文件管理器不显示空目录）', () => {
    expect(normPath('/')).toBe('/');
    expect(normPath('//')).toBe('/');
    expect(normPath('/..')).toBe('/..');
  });

  it('pathSegments 拆盘符与目录', () => {
    expect(pathSegments('C:/Users/foo')).toEqual(['C:', 'Users', 'foo']);
    expect(pathSegments('/Users/foo')).toEqual(['Users', 'foo']);
    expect(pathSegments('C:/')).toEqual(['C:']);
    expect(pathSegments('/')).toEqual([]);
  });

  it('segmentsToPath 还原盘符根与文件系统根', () => {
    expect(segmentsToPath(['C:'])).toBe('C:/');
    expect(segmentsToPath(['C:', 'Users'])).toBe('C:/Users');
    expect(segmentsToPath(['Users'])).toBe('/Users');
    expect(segmentsToPath([])).toBe('');
  });

  it('parentOf 跨平台返回上级', () => {
    expect(parentOf('C:/Users/foo')).toBe('C:/Users');
    expect(parentOf('C:/Users')).toBe('C:/');
    expect(parentOf('C:/')).toBeNull();
    expect(parentOf('/Users')).toBe('/');
    expect(parentOf('/')).toBeNull();
  });

  it('isDriveRoot 识别盘符根', () => {
    expect(isDriveRoot('C:/')).toBe(true);
    expect(isDriveRoot('C:')).toBe(true);
    expect(isDriveRoot('C:/Users')).toBe(false);
    expect(isDriveRoot('/')).toBe(false);
  });

  it('compactPathSegments 短路径全部保留', () => {
    const segs = ['Users', 'wuzhe'];
    const { visible, hiddenCount } = compactPathSegments(segs, segmentsToPath);
    expect(visible.map((c) => c.seg)).toEqual(['Users', 'wuzhe']);
    expect(visible[1]!.full).toBe('/Users/wuzhe');
    expect(hiddenCount).toBe(0);
  });

  it('compactPathSegments 超长路径省略高层级目录', () => {
    const segs = ['Users', 'wuzhe', 'Documents', 'projects', 'Vrykell', 'src'];
    const { visible, hiddenCount } = compactPathSegments(segs, segmentsToPath, 16);
    // 只保留最深层级：src、Vrykell（从深往前累计 ≤ 16 字符；projects 放不下）
    expect(visible.map((c) => c.seg)).toEqual(['Vrykell', 'src']);
    // 每个可见段仍指向完整路径（点击导航正确）
    expect(visible[1]!.full).toBe('/Users/wuzhe/Documents/projects/Vrykell/src');
    expect(hiddenCount).toBe(4);
  });

  it('compactPathSegments 单个长段也保留（无法再省略）', () => {
    const segs = ['a-very-long-directory-name-that-exceeds-capacity'];
    const { visible, hiddenCount } = compactPathSegments(segs, segmentsToPath, 5);
    expect(visible).toHaveLength(1);
    expect(hiddenCount).toBe(0);
  });
});
