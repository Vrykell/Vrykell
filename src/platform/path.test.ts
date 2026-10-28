import { describe, it, expect } from 'vitest';
import { normPath, pathSegments, segmentsToPath, parentOf, isDriveRoot } from '@platform/path';

describe('platform/path', () => {
  it('normalizes extended disk and share paths without damaging device namespaces', () => {
    expect(normPath('\\\\?\\D:\\projects\\file.go')).toBe('D:/projects/file.go');
    expect(normPath('\\\\?\\UNC\\server\\share\\file.go')).toBe('//server/share/file.go');
    expect(segmentsToPath(pathSegments('\\\\?\\UNC\\server\\share\\folder'))).toBe('//server/share/folder');
    expect(parentOf('//server/share/folder')).toBe('//server/share');
    expect(parentOf('//server/share')).toBeNull();
    expect(normPath('\\\\?\\Volume{abc}\\file')).toBe('//?/Volume{abc}/file');
  });
  it('normPath normalizes backslashes and strips trailing slashes', () => {
    expect(normPath('C:\\Users\\foo\\')).toBe('C:/Users/foo');
    expect(normPath('C:\\')).toBe('C:/');
    expect(normPath('C:/Users/foo/')).toBe('C:/Users/foo');
    expect(normPath('/Users/foo')).toBe('/Users/foo');
    // OSC 7 Windows drive form -> drive
    expect(normPath('/C:/Users/foo')).toBe('C:/Users/foo');
    expect(normPath('/C:/')).toBe('C:/');
    expect(normPath('/C:')).toBe('C:/');
  });

  it('normPath keeps the filesystem root (so the file manager does not show an empty directory after cd /)', () => {
    expect(normPath('/')).toBe('/');
    expect(normPath('//')).toBe('/');
    expect(normPath('/..')).toBe('/..');
  });

  it('normPath keeps the root slash for a drive root (C: is drive-relative; only C:/ is the root)', () => {
    expect(normPath('C:')).toBe('C:/');
    expect(normPath('c:\\')).toBe('c:/');
  });

  it('pathSegments splits drive and directories', () => {
    expect(pathSegments('C:/Users/foo')).toEqual(['C:', 'Users', 'foo']);
    expect(pathSegments('/Users/foo')).toEqual(['Users', 'foo']);
    expect(pathSegments('C:/')).toEqual(['C:']);
    expect(pathSegments('/')).toEqual([]);
  });

  it('segmentsToPath restores the drive root and filesystem root', () => {
    expect(segmentsToPath(['C:'])).toBe('C:/');
    expect(segmentsToPath(['C:', 'Users'])).toBe('C:/Users');
    expect(segmentsToPath(['Users'])).toBe('/Users');
    expect(segmentsToPath([])).toBe('');
  });

  it('parentOf returns the parent across platforms', () => {
    expect(parentOf('C:/Users/foo')).toBe('C:/Users');
    expect(parentOf('C:/Users')).toBe('C:/');
    expect(parentOf('C:/')).toBeNull();
    expect(parentOf('/Users')).toBe('/');
    expect(parentOf('/')).toBeNull();
  });

  it('isDriveRoot recognizes a drive root', () => {
    expect(isDriveRoot('C:/')).toBe(true);
    expect(isDriveRoot('C:')).toBe(true);
    expect(isDriveRoot('C:/Users')).toBe(false);
    expect(isDriveRoot('/')).toBe(false);
  });
});
