import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import FileSearchMenu from '../components/FileSearchMenu';
import { createLocalFileOps } from '../services/localFileOps';
import { searchFiles, type FileSearchResult } from '../services/fileSearch';
import type { FileOps } from '../model/fileOps';

const hit = { name: 'early.log', path: '/project/early.log', is_dir: false };
const partial: FileSearchResult = { entries: [hit], truncated: false, skipped: 0 };

it('renders partial results while traversal is pending and ignores a superseded search', async () => {
  const requests: { signal: AbortSignal; progress: (result: FileSearchResult) => void; finish: (result: FileSearchResult) => void }[] = [];
  const ops = createLocalFileOps();
  ops.search = vi.fn<NonNullable<FileOps['search']>>((_root, _query, signal, progress) => new Promise<FileSearchResult>(resolve => {
    requests.push({ signal, progress: progress!, finish: resolve });
  }));
  render(<FileSearchMenu ops={ops} root="/project" returnFocus={null} onChoose={vi.fn()} onClose={vi.fn()} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'early' } });
  await waitFor(() => expect(requests).toHaveLength(1));
  await act(async () => requests[0].progress(partial));
  expect(screen.getByRole('button', { name: /early.log/ })).toBeVisible();
  expect(screen.getByRole('status')).toHaveTextContent('正在搜索文件');
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'new' } });
  expect(requests[0].signal.aborted).toBe(true);
  await waitFor(() => expect(requests).toHaveLength(2));
  await act(async () => { requests[0].progress(partial); requests[0].finish(partial); });
  expect(screen.queryByRole('button', { name: /early.log/ })).not.toBeInTheDocument();
  await act(async () => requests[1].finish({ entries: [], truncated: false, skipped: 0 }));
  expect(screen.getByText('没有匹配的文件')).toBeVisible();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

it('publishes local matches before waiting for a deeper directory', async () => {
  let finish!: (value: { base: null; entries: typeof hit[] }) => void;
  const progress = vi.fn();
  const list = vi.fn().mockResolvedValueOnce({ base: null, entries: [hit, { name: 'nested', path: '/project/nested', is_dir: true }] })
    .mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const controller = new AbortController();
  const search = searchFiles({ list }, '/project', 'log', controller.signal, progress);
  await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  expect(progress).toHaveBeenCalledWith(partial);
  controller.abort();
  finish({ base: null, entries: [{ ...hit, path: '/project/nested/late.log' }] });
  expect((await search).entries).toEqual([hit]);
});
