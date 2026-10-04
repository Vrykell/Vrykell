import { describe, expect, it } from 'vitest';
import { normalizeWorkingDirectory, workingDirectoryFromUri } from '../workingDirectory';

describe('working directory paths', () => {
  it.each([
    ['/C:/Users/37863', 'C:/Users/37863'],
    ['/d:/', 'd:/'],
    ['/home/user', '/home/user'],
    ['/c/project', '/c/project'],
    ['//server/share', '//server/share'],
    ['C:\\projects', 'C:\\projects'],
  ])('normalizes %s without changing other path prefixes', (path, expected) => {
    expect(normalizeWorkingDirectory(path)).toBe(expected);
  });

  it.each([
    ['file://host/C:/Users/My Project', 'C:/Users/My Project'],
    ['file://remote/home/用户', '/home/用户'],
    ['file:///C:/', 'C:/'],
    ['file://host/home/100%20done', '/home/100%20done'],
    ['file://host', undefined],
    ['https://host/home', undefined],
  ])('reads the raw path from %s', (uri, expected) => {
    expect(workingDirectoryFromUri(uri)).toBe(expected);
  });
});
