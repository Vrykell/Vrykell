/**
 * fileIcon — 扩展名分类测试。
 */
import { describe, it, expect } from 'vitest';
import { fileIcon } from '@features/files/utils/fileIcon';
import { File, FileArchive, FileCode, FileCog, FileImage, FileText, Folder } from '@ui/icons';

describe('fileIcon', () => {
  it('目录恒为 Folder', () => {
    expect(fileIcon('a.txt', true)).toBe(Folder);
  });
  it('按扩展名分类', () => {
    expect(fileIcon('main.rs')).toBe(FileCode);
    expect(fileIcon('README.md')).toBe(FileText);
    expect(fileIcon('photo.png')).toBe(FileImage);
    expect(fileIcon('package.json')).toBe(FileCog);
    expect(fileIcon('archive.zip')).toBe(FileArchive);
    expect(fileIcon('noext')).toBe(File);
    expect(fileIcon('.env')).toBe(FileCog); // 按文件名匹配
  });
});
