import UploadManager from '../components/UploadManager';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import DownloadManager from '../components/DownloadManager';
import { transferPercent, type TransferJob } from '../services/transfers';

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
