/**
 * Map file extensions to shared icons using broad categories.
 * File panels and search results use the same mapping.
 */

import {
  File,
  FileArchive,
  FileCode,
  FileCog,
  FileImage,
  FileText,
  Folder,
  type AppIcon,
} from '@ui/icons';

const CODE = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'rs', 'go', 'py', 'rb', 'java',
  'c', 'cpp', 'h', 'hpp', 'cs', 'swift', 'kt', 'vue', 'svelte',
  'html', 'css', 'scss', 'less', 'sql', 'sh', 'bash', 'zsh', 'fish',
]);

const TEXT = new Set(['md', 'txt', 'log', 'pdf']);
const IMAGE = new Set(['svg', 'png', 'jpg', 'jpeg', 'gif', 'ico', 'webp', 'bmp']);
const CONFIG = new Set(['json', 'yml', 'yaml', 'toml', 'cfg', 'ini', 'lock', 'gitignore', 'env']);
const ARCHIVE = new Set(['zip', 'tar', 'gz', 'rar', '7z']);

export function fileIcon(name: string, isDir = false): AppIcon {
  if (isDir) return Folder;
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (CODE.has(ext)) return FileCode;
  if (TEXT.has(ext)) return FileText;
  if (IMAGE.has(ext)) return FileImage;
  if (CONFIG.has(ext) || CONFIG.has(name)) return FileCog;
  if (ARCHIVE.has(ext)) return FileArchive;
  return File;
}
