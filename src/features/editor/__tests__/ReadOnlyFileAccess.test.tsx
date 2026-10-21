import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { openInTerminal } from '@features/files';
import ReadOnlyFileAccess from '../components/ReadOnlyFileAccess';

vi.mock('@features/files', () => ({ openInTerminal: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@platform/runtime', () => ({ isWindows: true }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const file = { path: '/protected/config' };

it('keeps elevation behind an explicit permission action', () => {
  render(<ReadOnlyFileAccess file={file} permissionDenied active />);
  expect(screen.queryByRole('menu')).toBeNull();
  expect(openInTerminal).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '只读' }));
  expect(screen.getByRole('menu', { name: '文件权限' })).toBeVisible();
  expect(screen.getByText(/当前用户无权读取或写入此文件/)).toBeVisible();
  expect(openInTerminal).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '以管理员权限打开' }));
  expect(openInTerminal).toHaveBeenCalledExactlyOnceWith(file, true);
  expect(screen.queryByRole('menu')).toBeNull();
});

it('uses the remote terminal elevation path and dismisses when the document becomes inactive', () => {
  const remote = { ...file, connectionId: 'host' };
  const { rerender } = render(<ReadOnlyFileAccess file={remote} active />);
  fireEvent.click(screen.getByRole('button', { name: '只读' }));
  expect(screen.getByRole('button', { name: '使用 sudo 在终端编辑' })).toBeVisible();
  rerender(<ReadOnlyFileAccess file={remote} active={false} />);
  expect(screen.queryByRole('menu')).toBeNull();
  expect(openInTerminal).not.toHaveBeenCalled();
});
