import UploadManager from '../components/UploadManager';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import DownloadManager from '../components/DownloadManager';
import { transferPercent, type TransferJob } from '../services/transfers';
import type { DownloadEntry } from '../services/downloads';

const mocks = vi.hoisted(() => ({ list: vi.fn(), control: vi.fn(), clear: vi.fn(), remove: vi.fn(), history: vi.fn(), historyRemove: vi.fn() }));
vi.mock('../services/transfers', async () => ({ ...await vi.importActual<typeof import('../services/transfers')>('../services/transfers'), transfersList: mocks.list, transfersControl: mocks.control, transfersClear: mocks.clear, transfersDelete: mocks.remove }));
vi.mock('../services/downloads', () => ({ downloadsList: mocks.history, downloadsDelete: mocks.historyRemove }));
vi.mock('@tauri-apps/plugin-opener', () => ({ revealItemInDir: vi.fn() }));

const job: TransferJob = { id: 'upload-1', connectionId: 'c1', connectionName: 'Server', direction: 'upload', name: 'large.bin', localPath: '/local/large.bin', remotePath: '/remote/large.bin', isDir: false, status: 'running', bytes: 50, total: 100, speed: 10, error: '', createdAt: 1 };
beforeEach(() => { vi.clearAllMocks(); mocks.list.mockResolvedValue([job]); mocks.history.mockResolvedValue([]); mocks.control.mockResolvedValue(undefined); mocks.clear.mockResolvedValue(undefined); mocks.remove.mockResolvedValue(undefined); mocks.historyRemove.mockResolvedValue(undefined); });

it('shows upload byte progress and controls the task without removing its record', async () => {
  mocks.list.mockResolvedValueOnce([job]).mockResolvedValue([{ ...job, status: 'paused', speed: 0 }]);
  render(<UploadManager onBack={() => {}} />);
  expect(await screen.findByText('large.bin')).toBeVisible();
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
  fireEvent.click(screen.getByRole('button', { name: '暂停' }));
  await waitFor(() => expect(mocks.control).toHaveBeenCalledWith('upload-1', 'pause'));
  fireEvent.click(await screen.findByRole('button', { name: '继续传输' }));
  await waitFor(() => expect(mocks.control).toHaveBeenCalledWith('upload-1', 'resume'));
  fireEvent.click(screen.getByRole('button', { name: '取消传输' }));
  await waitFor(() => expect(mocks.control).toHaveBeenCalledWith('upload-1', 'cancel'));
});

it('keeps download and upload management on separate pages without a direction selector', async () => {
  mocks.history.mockResolvedValue([{ id: 1, name: 'old.zip', localPath: '/old.zip', remotePath: '/old.zip', connectionName: 'Server', isDir: false, size: 8, downloadedAt: 1 }]);
  const view = render(<DownloadManager onBack={() => {}} />);
  expect(await screen.findByText('old.zip')).toBeVisible();
  expect(screen.getByTestId('download-item-old.zip')).toHaveClass('transfer-record', 'transfer-record-history');
  expect(screen.getByTestId('download-reveal-old.zip')).toHaveClass('transfer-action');
  expect(screen.queryByText('large.bin')).not.toBeInTheDocument();
  expect(screen.getByText('下载管理')).toBeVisible();
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  view.unmount();
  render(<UploadManager onBack={() => {}} />);
  expect(await screen.findByText('large.bin')).toBeVisible();
  expect(screen.getByTestId('transfer-upload-1')).toHaveClass('transfer-record');
  expect(screen.getByText('上传管理')).toBeVisible();
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  expect(screen.queryByText('old.zip')).not.toBeInTheDocument();
});

it('offers recovery for interrupted jobs', async () => {
  mocks.list.mockResolvedValue([{ ...job, status: 'interrupted', speed: 0 }]);
  render(<UploadManager onBack={() => {}} />);
  expect(await screen.findByText(/传输已中断/)).toBeVisible();
  expect(screen.getByRole('button', { name: '继续传输' })).toBeVisible();
});

it('bounds progress and handles empty files', () => {
  expect(transferPercent({ bytes: 0, total: 0, status: 'running' })).toBe(0);
  expect(transferPercent({ bytes: 0, total: 0, status: 'completed' })).toBe(100);
  expect(transferPercent({ bytes: 120, total: 100, status: 'paused' })).toBe(100);
});

it('hides completed progress and deletes only the selected record', async () => {
  mocks.list.mockResolvedValue([{ ...job, status: 'completed', bytes: 100 }]);
  render(<UploadManager onBack={() => {}} />);
  expect(await screen.findByText(/传输完成/)).toBeVisible();
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  expect(screen.queryByTestId('transfer-controls-upload-1')).not.toBeInTheDocument();
  const remove = await screen.findByTestId('transfer-delete-upload-1');
  fireEvent.click(remove);
  await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith('upload-1'));
});

it('deletes a paused task record so its staged data does not outlive it', async () => {
  mocks.list.mockResolvedValue([{ ...job, status: 'paused', speed: 0 }]);
  render(<UploadManager onBack={() => {}} />);
  expect(await screen.findByText(/已暂停/)).toBeVisible();
  fireEvent.click(await screen.findByTestId('transfer-delete-upload-1'));
  await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith('upload-1'));
});

it('deletes a legacy download history record without deleting its file', async () => {
  mocks.list.mockResolvedValue([]);
  mocks.history.mockResolvedValue([{ id: 7, name: 'old.zip', localPath: '/old.zip', remotePath: '/old.zip', connectionName: 'Server', isDir: false, size: 8, downloadedAt: 1 }]);
  render(<DownloadManager onBack={() => {}} />);
  fireEvent.click(await screen.findByTestId('download-delete-7'));
  await waitFor(() => expect(mocks.historyRemove).toHaveBeenCalledWith(7));
});

it('clears completed uploads only after confirmation', async () => {
  mocks.list.mockResolvedValueOnce([{ ...job, status: 'completed' }]).mockResolvedValue([]);
  render(<UploadManager onBack={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: '清空已完成记录' }));
  expect(mocks.clear).not.toHaveBeenCalled();
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '清空已完成记录' }));
  await waitFor(() => expect(mocks.clear).toHaveBeenCalledWith('upload'));
  expect(await screen.findByText('暂无传输记录')).toBeVisible();
});

it('keeps history failures visible when transfer polling succeeds', async () => {
  mocks.history.mockRejectedValue(new Error('History unavailable'));
  render(<DownloadManager onBack={() => {}} />);
  expect(await screen.findByText('Error: History unavailable')).toBeVisible();
  expect(screen.getByRole('button', { name: '重试' })).toBeVisible();
});

it('waits for both task and download history responses before showing an empty state', async () => {
  let finishJobs!: (jobs: TransferJob[]) => void;
  let finishHistory!: (entries: DownloadEntry[]) => void;
  mocks.list.mockReturnValue(new Promise<TransferJob[]>(resolve => { finishJobs = resolve; }));
  mocks.history.mockReturnValue(new Promise<DownloadEntry[]>(resolve => { finishHistory = resolve; }));
  const onBack = vi.fn();
  render(<DownloadManager onBack={onBack} />);
  expect(screen.getByRole('status')).toHaveTextContent('正在加载传输记录');
  expect(screen.queryByText('暂无传输记录')).not.toBeInTheDocument();
  await act(async () => finishJobs([]));
  expect(screen.getByRole('status')).toHaveTextContent('正在加载传输记录');
  await act(async () => finishHistory([]));
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.getByText('暂无传输记录')).toBeVisible();
  expect(screen.getByText(/在远程文件面板下载文件或文件夹后/)).toBeVisible();
  fireEvent.click(screen.getAllByRole('button', { name: '返回文件浏览' })[1]);
  expect(onBack).toHaveBeenCalledOnce();
});

it('groups tasks by status, keeps newest records first and exposes transfer endpoints', async () => {
  mocks.list.mockResolvedValue([
    { ...job, id: 'old', name: 'old.bin' },
    { ...job, id: 'failed', name: 'failed.bin', status: 'failed', error: 'Permission denied' },
    { ...job, id: 'done', name: 'done.bin', status: 'completed' },
    { ...job, id: 'new', name: 'new.bin', createdAt: 2 },
    { ...job, id: 'download', name: 'download.bin', direction: 'download' },
  ]);
  render(<UploadManager onBack={() => {}} />);
  const ongoing = await screen.findByRole('region', { name: '进行中' });
  expect(within(ongoing).getAllByRole('article').map(card => card.getAttribute('aria-label'))).toEqual(['new.bin', 'old.bin']);
  expect(within(screen.getByRole('region', { name: '已停止' })).getByRole('article', { name: 'failed.bin' })).toBeVisible();
  expect(within(screen.getByRole('region', { name: '已完成' })).getByRole('article', { name: 'done.bin' })).toBeVisible();
  expect(screen.queryByText('download.bin')).not.toBeInTheDocument();
  const newest = within(screen.getByRole('article', { name: 'new.bin' }));
  expect(newest.getByText('Server')).toBeVisible();
  expect(newest.getAllByRole('definition').map(path => path.textContent)).toEqual(['/local/large.bin', '/remote/large.bin']);
  expect(newest.getByText('10 B/s')).toBeVisible();
  expect(newest.getByText('约剩余 5 秒')).toBeVisible();
  expect(screen.getByRole('alert')).toHaveTextContent('Permission denied');
});

it('merges legacy download records into the same completed group without duplicates', async () => {
  const entry: DownloadEntry = { id: 8, name: 'large.bin', localPath: '/local/large.bin', remotePath: '/remote/large.bin', connectionName: 'Server', isDir: false, size: 100, downloadedAt: 2 };
  mocks.history.mockResolvedValue([entry, { ...entry, id: 9, name: 'older.zip', localPath: '/local/older.zip', remotePath: '/remote/older.zip', downloadedAt: 1 }]);
  mocks.list.mockResolvedValue([{ ...job, direction: 'download', status: 'completed', bytes: 100, createdAt: 3 }]);
  render(<DownloadManager onBack={() => {}} />);
  const complete = await screen.findByRole('region', { name: '已完成' });
  await waitFor(() => expect(within(complete).getAllByRole('article')).toHaveLength(2));
  expect(screen.getAllByText('large.bin')).toHaveLength(1);
  expect(within(screen.getByRole('article', { name: 'large.bin' })).getAllByRole('definition').map(path => path.textContent)).toEqual(['/remote/large.bin', '/local/large.bin']);
  mocks.list.mockResolvedValue([]);
  mocks.history.mockResolvedValue([{ ...entry, id: 9, name: 'older.zip', localPath: '/local/older.zip', remotePath: '/remote/older.zip', downloadedAt: 1 }]);
  fireEvent.click(screen.getByTestId('transfer-delete-upload-1'));
  await waitFor(() => expect(screen.queryByText('large.bin')).not.toBeInTheDocument());
  expect(await screen.findByText('older.zip')).toBeVisible();
  expect(mocks.history).toHaveBeenCalledTimes(2);
});

it('disables task actions while an operation is pending and restores them after failure', async () => {
  let rejectControl!: (reason: Error) => void;
  mocks.control.mockReturnValue(new Promise<void>((_, reject) => { rejectControl = reject; }));
  render(<UploadManager onBack={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: '暂停' }));
  const card = screen.getByRole('article', { name: 'large.bin' });
  expect(card).toHaveAttribute('aria-busy', 'true');
  for (const button of within(card).getAllByRole('button')) expect(button).toBeDisabled();
  await act(async () => rejectControl(new Error('Connection lost')));
  expect(card).toHaveAttribute('aria-busy', 'false');
  expect(screen.getByRole('button', { name: '暂停' })).toBeEnabled();
});

it('describes transfer preparation without inventing a percentage or remaining time', async () => {
  mocks.list.mockResolvedValue([{ ...job, bytes: 0, total: 0, speed: 0 }]);
  render(<UploadManager onBack={() => {}} />);
  expect(await screen.findByText('正在准备传输…')).toBeVisible();
  expect(screen.queryByText('0%')).not.toBeInTheDocument();
  expect(screen.queryByText(/约剩余/)).not.toBeInTheDocument();
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
});
