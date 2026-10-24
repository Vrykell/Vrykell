import { expect, it } from 'vitest';
import { fileIcon } from './utils/fileIcon';
import { File, FileArchive, FileCode, FileCog, FileImage, FileText, Folder } from '@ui/icons';

it('uses the existing neutral icon family for files and directories', () => {
  expect(fileIcon('folder', true)).toBe(Folder);
  expect(fileIcon('main.rs')).toBe(FileCode);
  expect(fileIcon('README.md')).toBe(FileText);
  expect(fileIcon('image.png')).toBe(FileImage);
  expect(fileIcon('package.json')).toBe(FileCog);
  expect(fileIcon('archive.zip')).toBe(FileArchive);
  expect(fileIcon('noext')).toBe(File);
});
