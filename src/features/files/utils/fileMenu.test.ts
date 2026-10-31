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

    items[0]!.onClick?.();

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
    row[0]!.onClick?.();
    expect(onReveal).toHaveBeenCalledWith(file);

    const more = buildFileMenuItems(['reveal'], ctx({ handlers: handlers({ onReveal, onRevealDir }) }));
    expect(more).toHaveLength(1);
    more[0]!.onClick?.();
    expect(onRevealDir).toHaveBeenCalledWith('/work');

    // Renders nothing without the matching handler (unsupported panel, such as a remote one)
    expect(buildFileMenuItems(['reveal'], ctx({ entry: file, targets: [file] }))).toHaveLength(0);
    expect(buildFileMenuItems(['reveal'], ctx())).toHaveLength(0);
  });

  it('offers the preferred editor only when the panel provides a handler', () => {
    const onOpenEditor = vi.fn();
    const file = entry('a.txt', '/work/a.txt');

    const row = buildFileMenuItems(['open-editor'], ctx({ entry: file, targets: [file], handlers: handlers({ onOpenEditor }) }));
    expect(row).toHaveLength(1);
    expect(row[0]!.label).toBe('使用首选编辑器打开');
    row[0]!.onClick?.();
    expect(onOpenEditor).toHaveBeenCalledWith(file);

    // A panel without the handler never renders an inert open action.
    expect(buildFileMenuItems(['open-editor'], ctx({ entry: file, targets: [file] }))).toHaveLength(0);
  });

  it('offers properties for a single row only, and calls the handler with that entry', () => {
    const onProperties = vi.fn();
    const file = entry('a.txt', '/work/a.txt');

    const row = buildFileMenuItems(['properties'], ctx({ entry: file, targets: [file], handlers: handlers({ onProperties }) }));
    expect(row).toHaveLength(1);
    expect(row[0]!.label).toBe('属性');
    row[0]!.onClick?.();
    expect(onProperties).toHaveBeenCalledWith(file);

    // No handler (panel does not support it) or a group hit renders nothing
    expect(buildFileMenuItems(['properties'], ctx({ entry: file, targets: [file] }))).toHaveLength(0);
    expect(buildFileMenuItems(['properties'], ctx({
      entry: file,
      targets: [file, entry('b.txt', '/work/b.txt')],
      handlers: handlers({ onProperties }),
    }))).toHaveLength(0);
    expect(buildFileMenuItems(['properties'], ctx({ handlers: handlers({ onProperties }) }))).toHaveLength(0);
  });

  it('offers sync-to-cwd only when the panel provides a handler', () => {
    const onSyncToCwd = vi.fn();
    const withHandler = buildFileMenuItems(['sync-cwd'], ctx({ handlers: handlers({ onSyncToCwd }) }));
    expect(withHandler).toHaveLength(1);
    expect(withHandler[0]!.label).toBe('切换到当前终端文件目录');
    withHandler[0]!.onClick?.();
    expect(onSyncToCwd).toHaveBeenCalledTimes(1);

    // Remote panels provide no handler, so nothing renders
    expect(buildFileMenuItems(['sync-cwd'], ctx())).toHaveLength(0);
  });

  it('offers refresh only when the panel provides a handler', () => {
    const onRefresh = vi.fn();
    const withHandler = buildFileMenuItems(['refresh'], ctx({ handlers: handlers({ onRefresh }) }));
    expect(withHandler).toHaveLength(1);
    expect(withHandler[0]!.label).toBe('刷新');
    withHandler[0]!.onClick?.();
    expect(onRefresh).toHaveBeenCalledTimes(1);

    // No handler (panel does not support it) means no item.
    expect(buildFileMenuItems(['refresh'], ctx())).toHaveLength(0);
  });
});
