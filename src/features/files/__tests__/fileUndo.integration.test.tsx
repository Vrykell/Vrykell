import { mkdtemp, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useFileUndoSettings } from '@config/fileUndo';
import { useFileBrowser } from '../hooks/useFileBrowser';
import type { FileOpPair, FileOpsTarget } from '../model/fileOps';

const api = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), rename: vi.fn(), remove: vi.fn(), move: vi.fn(), restore: vi.fn(), clipboard: vi.fn() }));
vi.mock('@platform/api/fs', async () => ({
  ...await vi.importActual<typeof import('@platform/api/fs')>('@platform/api/fs'),
  fsList: api.list, fsCreateFile: api.create, fsCreateDir: api.create,
  fsRename: api.rename, fsStageDelete: api.remove, fsMove: api.move, fsRestoreStaged: api.restore,
}));
vi.mock('@platform/clipboard', () => ({ writeClipboardFiles: api.clipboard }));
vi.mock('@features/ssh/services/api', () => ({ sshFsList: async () => ({ base: '/remote', entries: [] }) }));

let root: string;
const local: FileOpsTarget = { kind: 'local' };
const file = (path: string) => ({ path, name: path.split('/').pop()!, is_dir: false });
beforeEach(async () => {
  vi.resetAllMocks();
  root = (await mkdtemp(join(tmpdir(), 'file-undo-'))).replace(/\\/g, '/');
  useFileUndoSettings.setState({ local: true, remote: true });
  api.list.mockImplementation(async (path: string) => (await readdir(path, { withFileTypes: true })).map(entry => ({
    path: `${path}/${entry.name}`, name: entry.name, is_dir: entry.isDirectory(),
  })));
  api.create.mockImplementation(async (dir: string, name: string) => {
    const path = `${dir}/${name}`; await writeFile(path, 'owned', { flag: 'wx' }); return path;
  });
  api.rename.mockImplementation(async (path: string, name: string) => {
    const parent = path.slice(0, path.lastIndexOf('/'));
    let destination = `${parent}/${name}`;
    for (let i = 1; existsSync(destination); i++) destination = `${parent}/${name} (${i})`;
    await rename(path, destination); return destination;
  });
  api.move.mockImplementation(async (paths: string[], destination: string) => {
    const completed: FileOpPair[] = [];
    for (const path of paths) {
      const name = path.split('/').pop()!;
      let target = `${destination}/${name}`;
      for (let i = 1; existsSync(target); i++) target = `${destination}/${name} (${i})`;
      await rename(path, target); completed.push({ from: path, to: target });
    }
    return { completed, errors: [] };
  });
  api.remove.mockImplementation(async (paths: string[]) => {
    const completed: FileOpPair[] = [];
    await mkdir(`${root}/staging`, { recursive: true });
    for (const path of paths) {
      const staged = `${root}/staging/${completed.length}-${path.split('/').pop()}`;
      await rename(path, staged); completed.push({ from: path, to: staged });
    }
    return { completed, errors: [] };
  });
  api.clipboard.mockResolvedValue(undefined);
  api.restore.mockImplementation(async (pairs: FileOpPair[]) => {
    const completed: FileOpPair[] = []; const errors: string[] = [];
    for (const pair of pairs) {
      if (existsSync(pair.from)) { errors.push('Destination exists'); continue; }
      await rename(pair.to, pair.from); completed.push(pair);
    }
    return { completed, errors };
  });
});
afterEach(async () => { cleanup(); await rm(root, { recursive: true, force: true }); });

async function browser() {
  const hook = renderHook(() => useFileBrowser({ target: local, initialPath: root, openEntry: vi.fn() }));
  await waitFor(() => expect(hook.result.current.loadedPath).toBe(root));
  return hook;
}

it('keeps an unrelated colliding file intact through consecutive undo operations', async () => {
  const { result } = await browser();
  await act(async () => { await result.current.createEntry('file', null); });
  act(() => result.current.requestRename(file(`${root}/Untitled`), 'renamed'));
  await act(async () => { result.current.confirmAction(); });
  await waitFor(() => expect(result.current.undoCount).toBe(2));
  await writeFile(`${root}/Untitled`, 'unrelated');
  await act(async () => { await result.current.runUndo(); });
  await act(async () => { await result.current.runUndo(); });
  expect(await readFile(`${root}/Untitled`, 'utf8')).toBe('unrelated');
  expect(existsSync(`${root}/Untitled (1)`)).toBe(false);
});

it('keeps a new undo record added while an older filesystem operation waits', async () => {
  const { result } = await browser();
  await act(async () => { await result.current.createEntry('file', null); });
  const remove = api.remove.getMockImplementation()!;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  api.remove.mockImplementationOnce(async (paths: string[]) => { await gate; return remove(paths); });
  let undo!: Promise<void>;
  act(() => { undo = result.current.runUndo(); });
  api.create.mockImplementationOnce(async () => { await writeFile(`${root}/newer`, 'newer'); return `${root}/newer`; });
  await act(async () => { await result.current.createEntry('file', null); });
  await act(async () => { release(); await undo; });
  expect(result.current.undo?.pairs[0].to).toBe(`${root}/newer`);
  await act(async () => { await result.current.runUndo(); });
  expect(existsSync(`${root}/newer`)).toBe(false);
});

it('rebases older creation records when undoing a move meets a new name collision', async () => {
  await mkdir(`${root}/destination`);
  const { result } = await browser();
  await act(async () => { await result.current.createEntry('file', null); });
  await act(async () => { await result.current.transferInto([`${root}/Untitled`], `${root}/destination`, 'move'); });
  await writeFile(`${root}/Untitled`, 'unrelated');
  await act(async () => { await result.current.runUndo(); });
  expect([...result.current.selection]).toEqual([`${root}/Untitled (1)`]);
  await act(async () => { await result.current.runUndo(); });
  expect(await readFile(`${root}/Untitled`, 'utf8')).toBe('unrelated');
  expect(existsSync(`${root}/Untitled (1)`)).toBe(false);
});

it('invalidates older destructive dependencies when a rename cannot be undone', async () => {
  const { result } = await browser();
  await act(async () => { await result.current.createEntry('file', null); });
  act(() => result.current.requestRename(file(`${root}/Untitled`), 'renamed'));
  await act(async () => { result.current.confirmAction(); });
  await waitFor(() => expect(result.current.undoCount).toBe(2));
  await rename(`${root}/renamed`, `${root}/outside`);
  await writeFile(`${root}/Untitled`, 'unrelated');
  await act(async () => { await result.current.runUndo(); });
  await act(async () => { await result.current.runUndo(); });
  expect(await readFile(`${root}/Untitled`, 'utf8')).toBe('unrelated');
  expect(result.current.undoCount).toBe(0);
});

it('ignores a second undo request while the first one is still running', async () => {
  const { result } = await browser();
  await act(async () => { await result.current.createEntry('file', null); });
  const remove = api.remove.getMockImplementation()!;
  let release!: () => void;
  api.remove.mockImplementationOnce(async (paths: string[]) => {
    await new Promise<void>(resolve => { release = resolve; }); return remove(paths);
  });
  let undo!: Promise<void>;
  act(() => { undo = result.current.runUndo(); });
  await act(async () => { await result.current.runUndo(); release(); await undo; });
  expect(api.remove).toHaveBeenCalledTimes(1);
  expect(result.current.undoCount).toBe(0);
});

it('keeps a replacement file intact after a failed delete restore and another undo', async () => {
  const { result } = await browser();
  await act(async () => { await result.current.createEntry('file', null); });
  act(() => result.current.confirmDelete([file(`${root}/Untitled`)]));
  await act(async () => { result.current.confirmAction(); });
  await waitFor(() => expect(result.current.undoCount).toBe(2));
  await writeFile(`${root}/Untitled`, 'replacement');
  await act(async () => { await result.current.runUndo(); });
  await act(async () => { await result.current.runUndo(); });
  expect(await readFile(`${root}/Untitled`, 'utf8')).toBe('replacement');
  expect(result.current.undoCount).toBe(0);
});

it('does not submit a remote copy or cut to the local file clipboard', async () => {
  const remote: FileOpsTarget = { kind: 'ssh', connectionId: 'remote' };
  const { result } = renderHook(() => useFileBrowser({ target: remote, initialPath: '/remote', openEntry: vi.fn() }));
  act(() => { result.current.copySelection([file('/remote/report')]); result.current.cutSelection([file('/remote/report')]); });
  await act(async () => {});
  expect(api.clipboard).not.toHaveBeenCalled();
});
