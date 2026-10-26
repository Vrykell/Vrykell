import { describe, it, expect } from 'vitest';
import { normalizeRemotePath, parentOfRemote, shellQuote } from '@features/ssh/utils/remotePath';

describe('normalizeRemotePath', () => {
  it('去尾部斜杠并合并 . / ..', () => {
    expect(normalizeRemotePath('/a/b/')).toBe('/a/b');
    expect(normalizeRemotePath('/a//b//c')).toBe('/a/b/c');
    expect(normalizeRemotePath('/a/b/../c')).toBe('/a/c');
    expect(normalizeRemotePath('/a/./b')).toBe('/a/b');
    expect(normalizeRemotePath('/a/../..')).toBe('/');
  });
});

describe('parentOfRemote', () => {
  it('逐级上溯，根再上返回 null', () => {
    expect(parentOfRemote('/a/b')).toBe('/a');
    expect(parentOfRemote('/a')).toBe('/');
    expect(parentOfRemote('/')).toBeNull();
    expect(parentOfRemote('')).toBeNull();
  });
});

describe('shellQuote', () => {
  it.each(['\x15', '\r', '\n', '\x1b', '\x7f', '\x9b'])('rejects terminal control character %j', control => {
    expect(() => shellQuote(`/tmp/a${control}echo unsafe`)).toThrow();
  });
  it('单引号包裹普通路径', () => {
    expect(shellQuote('/home/user/proj')).toBe("'/home/user/proj'");
  });
  it('路径含单引号时正确转义', () => {
    expect(shellQuote("/home/u/it's")).toBe("'/home/u/it'\\''s'");
  });
});
