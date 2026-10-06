/**
 * posixPath — 远端（POSIX）路径语义：宿主平台无关，绝对/相对判断与拼接都收口在平台层。
 */
import { describe, expect, it } from 'vitest';
import { baseNamePosix, fileNamePosix, isPosixAbsolute, joinPosix, normalizePosix, parentPosix } from '@platform/posixPath';

describe('posixPath 平台层', () => {
  it('绝对路径判断按 POSIX 规则，与宿主平台无关', () => {
    expect(isPosixAbsolute('/home/user')).toBe(true);
    expect(isPosixAbsolute('/')).toBe(true);
    expect(isPosixAbsolute('home/user')).toBe(false);
    expect(isPosixAbsolute('C:/Users')).toBe(false);
  });

  it('拼接不会产生双斜杠或反斜杠', () => {
    expect(joinPosix('/home/user', 'docs')).toBe('/home/user/docs');
    expect(joinPosix('/home/user/', 'docs')).toBe('/home/user/docs');
    expect(joinPosix('/', 'etc')).toBe('/etc');
    expect(joinPosix('', 'etc')).toBe('/etc');
  });

  it('规范化折叠重复分隔符、处理 .. 与尾部斜杠', () => {
    expect(normalizePosix('/home//user/')).toBe('/home/user');
    expect(normalizePosix('/home/user/../docs')).toBe('/home/docs');
    expect(normalizePosix('/..')).toBe('/');
    expect(normalizePosix('')).toBe('/');
  });

  it('父目录与文件名在根目录处返回 null', () => {
    expect(parentPosix('/home/user/a.txt')).toBe('/home/user');
    expect(parentPosix('/home')).toBe('/');
    expect(parentPosix('/')).toBeNull();
    expect(fileNamePosix('/home/user/a.txt')).toBe('a.txt');
    expect(fileNamePosix('/home/user/')).toBe('user');
    expect(fileNamePosix('/')).toBeNull();
    expect(baseNamePosix('/')).toBe('/');
  });
});
