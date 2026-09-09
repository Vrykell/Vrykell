/**
 * fileIcon — 扩展名分类测试。
 */

import { File, FileArchive, FileCode, FileCog, FileImage, FileText, Folder } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { fileIcon } from '@/features/files/services/fileIcon';

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
