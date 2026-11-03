import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AboutPage } from '../pages/aboutPage';
import { useAppUpdate } from '../stores/appUpdate';

vi.mock('@platform/updater', () => ({ applicationVersion: async () => '0.1.0', supportsAppUpdates: () => true, openProjectPage: vi.fn() }));
afterEach(() => { cleanup(); useAppUpdate.setState({ phase: 'idle', error: '', downloaded: 0, total: undefined, version: '', notes: '' }); vi.restoreAllMocks(); });

it('shows application identity and requires explicit confirmation before installation', async () => {
  useAppUpdate.setState({ currentVersion: '0.1.0', phase: 'ready', version: '0.2.0', notes: 'New release', error: '' });
  const install = vi.spyOn(useAppUpdate.getState(), 'install').mockImplementation(() => {});
  render(<AboutPage />);
  expect(screen.getByRole('heading', { name: 'Vrykell' })).toBeVisible();
  expect(screen.getByTestId('application-version')).toHaveTextContent('0.1.0');
  fireEvent.click(screen.getByRole('button', { name: '安装并重启' }));
  expect(screen.getByRole('dialog', { name: '安装更新并重启？' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '稍后' }));
  expect(install).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '安装并重启' }));
  fireEvent.click(screen.getByTestId('confirm-ok'));
  expect(install).toHaveBeenCalledOnce();
});

it('fills the primary action with download progress instead of showing a separate bar', () => {
  useAppUpdate.setState({ currentVersion: '0.1.0', phase: 'downloading', version: '0.2.0', downloaded: 25, total: 100, error: '' });
  render(<AboutPage />);
  const action = screen.getByRole('button', { name: '正在下载…' });
  expect(action).toBeDisabled();
  expect(action).toHaveAttribute('data-downloading', 'true');
  expect(action).toHaveStyle({ backgroundSize: '25% 100%' });
  expect(screen.getByText('正在下载更新 · 25 B')).toBeVisible();
  expect(screen.getByRole('progressbar', { name: '更新下载进度', hidden: true })).toHaveAttribute('aria-valuenow', '25');
});
