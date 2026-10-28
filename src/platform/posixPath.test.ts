/**
 * posixPath — remote (POSIX) path semantics: independent of the host platform, with absolute
 * path checks and joining confined to the platform layer.
 */
import { describe, expect, it } from 'vitest';
import { baseNamePosix, fileNamePosix, isPosixAbsolute, joinPosix, normalizePosix, parentPosix } from '@platform/posixPath';

describe('posixPath platform layer', () => {
  it('detects absolute paths by POSIX rules regardless of the host platform', () => {
    expect(isPosixAbsolute('/home/user')).toBe(true);
    expect(isPosixAbsolute('/')).toBe(true);
    expect(isPosixAbsolute('home/user')).toBe(false);
    expect(isPosixAbsolute('C:/Users')).toBe(false);
  });

  it('joining never produces double slashes or backslashes', () => {
    expect(joinPosix('/home/user', 'docs')).toBe('/home/user/docs');
    expect(joinPosix('/home/user/', 'docs')).toBe('/home/user/docs');
    expect(joinPosix('/', 'etc')).toBe('/etc');
    expect(joinPosix('', 'etc')).toBe('/etc');
  });

  it('normalization collapses repeated separators, resolves .. and handles trailing slashes', () => {
    expect(normalizePosix('/home//user/')).toBe('/home/user');
    expect(normalizePosix('/home/user/../docs')).toBe('/home/docs');
    expect(normalizePosix('/..')).toBe('/');
    expect(normalizePosix('')).toBe('/');
  });

  it('parent directory and file name return null at the root', () => {
    expect(parentPosix('/home/user/a.txt')).toBe('/home/user');
    expect(parentPosix('/home')).toBe('/');
    expect(parentPosix('/')).toBeNull();
    expect(fileNamePosix('/home/user/a.txt')).toBe('a.txt');
    expect(fileNamePosix('/home/user/')).toBe('user');
    expect(fileNamePosix('/')).toBeNull();
    expect(baseNamePosix('/')).toBe('/');
  });
});
