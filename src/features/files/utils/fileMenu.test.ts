import { describe, expect, it, vi } from 'vitest';
import { buildFileMenuItems, type FileMenuContext, type FileMenuHandlers } from '@features/files/utils/fileMenu';
import type { FsEntry } from '@platform/api/types';

const entry = (name: string, path: string, is_dir = false): FsEntry => ({ name, path, is_dir });

function handlers(overrides: Partial<FileMenuHandlers> = {}): FileMenuHandlers {
  return {
    onNew: vi.fn(),
    onCopy: vi.fn(),
    onCut: vi.fn(),
    onPasteInto: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };
}

function ctx(overrides: Partial<FileMenuContext> = {}): FileMenuContext {
  return {
    entry: null,
    targets: [],
    currentDir: '/work',
    targetDir: '/work',
    clipboard: null,
    handlers: handlers(),
    ...overrides,
  };
}

describe('fileMenu', () => {
  it('pastes into the row target directory, so a file pastes into its sibling folder', () => {
    const onPasteInto = vi.fn();
    const file = entry('a.txt', '/work/sub/a.txt');
    const items = buildFileMenuItems(['paste'], ctx({
      entry: file,
      targets: [file],
      targetDir: '/work/sub',
      clipboard: { mode: 'copy', paths: ['/other/x'] },
      handlers: handlers({ onPasteInto }),
    }));

    items[0]!.onClick();

    expect(onPasteInto).toHaveBeenCalledWith('/work/sub');
  });

  it('uses the plain paste label for every target kind', () => {
    const folder = entry('sub', '/work/sub', true);
    const intoFolder = buildFileMenuItems(['paste'], ctx({
      entry: folder,
      targets: [folder],
      targetDir: '/work/sub',
      clipboard: { mode: 'cut', paths: ['/x'] },
    }));
    const intoCurrent = buildFileMenuItems(['paste'], ctx({ clipboard: { mode: 'cut', paths: ['/x'] } }));

    expect(intoFolder[0]!.label).toBe('粘贴');
    expect(intoCurrent[0]!.label).toBe('粘贴');
  });

  it('offers reveal for a row and for the current folder, only when the handlers exist', () => {
    const onReveal = vi.fn();
    const onRevealDir = vi.fn();
    const file = entry('a.txt', '/work/a.txt');

    const row = buildFileMenuItems(['reveal'], ctx({ entry: file, targets: [file], handlers: handlers({ onReveal, onRevealDir }) }));
    expect(row).toHaveLength(1);
    row[0]!.onClick();
    expect(onReveal).toHaveBeenCalledWith(file);

    const more = buildFileMenuItems(['reveal'], ctx({ handlers: handlers({ onReveal, onRevealDir }) }));
    expect(more).toHaveLength(1);
    more[0]!.onClick();
    expect(onRevealDir).toHaveBeenCalledWith('/work');

    // 没有对应 handler（面板不支持，例如远端）时不渲染
    expect(buildFileMenuItems(['reveal'], ctx({ entry: file, targets: [file] }))).toHaveLength(0);
    expect(buildFileMenuItems(['reveal'], ctx())).toHaveLength(0);
  });

  it('offers sync-to-cwd only when the panel provides a handler', () => {
    const onSyncToCwd = vi.fn();
    const withHandler = buildFileMenuItems(['sync-cwd'], ctx({ handlers: handlers({ onSyncToCwd }) }));
    expect(withHandler).toHaveLength(1);
    expect(withHandler[0]!.label).toBe('切换到当前终端文件目录');
    withHandler[0]!.onClick();
    expect(onSyncToCwd).toHaveBeenCalledTimes(1);

    // 远程面板不提供 handler → 不渲染
    expect(buildFileMenuItems(['sync-cwd'], ctx())).toHaveLength(0);
  });
});
