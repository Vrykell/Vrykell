import { describe, it, expect } from 'vitest';
import { normalizeRemotePath, parentOfRemote, shellQuote } from '@features/ssh/utils/remotePath';

describe('normalizeRemotePath', () => {
  it('removes trailing slashes and resolves . / ..', () => {
    expect(normalizeRemotePath('/a/b/')).toBe('/a/b');
    expect(normalizeRemotePath('/a//b//c')).toBe('/a/b/c');
    expect(normalizeRemotePath('/a/b/../c')).toBe('/a/c');
    expect(normalizeRemotePath('/a/./b')).toBe('/a/b');
    expect(normalizeRemotePath('/a/../..')).toBe('/');
  });
});

describe('parentOfRemote', () => {
  it('walks up level by level and returns null at the root', () => {
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
  it('wraps an ordinary path in single quotes', () => {
    expect(shellQuote('/home/user/proj')).toBe("'/home/user/proj'");
  });
  it('escapes a path containing single quotes correctly', () => {
    expect(shellQuote("/home/u/it's")).toBe("'/home/u/it'\\''s'");
  });
});
