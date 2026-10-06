import { describe, it, expect } from 'vitest';
import { normPath, pathSegments, segmentsToPath, parentOf, isDriveRoot } from '@platform/path';

describe('platform/path', () => {
  it('normPath 归一化反斜杠并去尾斜杠', () => {
    expect(normPath('C:\\Users\\foo\\')).toBe('C:/Users/foo');
    expect(normPath('C:\\')).toBe('C:/');
    expect(normPath('C:/Users/foo/')).toBe('C:/Users/foo');
    expect(normPath('/Users/foo')).toBe('/Users/foo');
    // OSC 7 的 Windows 盘符形式 → 盘符
    expect(normPath('/C:/Users/foo')).toBe('C:/Users/foo');
    expect(normPath('/C:/')).toBe('C:/');
    expect(normPath('/C:')).toBe('C:/');
  });

  it('normPath 保留文件系统根（cd / 后文件管理器不显示空目录）', () => {
    expect(normPath('/')).toBe('/');
    expect(normPath('//')).toBe('/');
    expect(normPath('/..')).toBe('/..');
  });

  it('normPath 盘符根保留根斜杠（C: 是驱动器相对路径，C:/ 才是根）', () => {
    expect(normPath('C:')).toBe('C:/');
    expect(normPath('c:\\')).toBe('c:/');
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
});
