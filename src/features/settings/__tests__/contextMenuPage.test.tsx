import { beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { ContextMenuPage } from '../pages/contextMenuPage';
import { getContextMenuStatus, manageContextMenu, type ContextMenuStatus } from '@platform/contextMenu';

vi.mock('@platform/contextMenu', () => ({ getContextMenuStatus: vi.fn(), manageContextMenu: vi.fn() }));
const initial: ContextMenuStatus = { supported: true, available: true, enabled: false, certificateTrusted: false, certificateThumbprint: 'ABCD' };
beforeEach(() => { vi.clearAllMocks(); vi.mocked(getContextMenuStatus).mockResolvedValue({ ...initial }); });
it('does not let an old status read undo a later trust action', async () => {
  let finish!: (status: ContextMenuStatus) => void;
  vi.mocked(getContextMenuStatus).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  vi.mocked(manageContextMenu).mockResolvedValue({ ...initial, certificateTrusted: true });
  render(<StrictMode><ContextMenuPage /></StrictMode>);
  fireEvent.click(await screen.findByRole('button', { name: '信任此证书' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '启用右键菜单' })).toBeEnabled());
  await act(async () => { finish({ ...initial }); });
  expect(screen.getByRole('button', { name: '启用右键菜单' })).toBeEnabled();
});

it('requires explicit certificate trust before enabling, then supports disabling and removing trust', async () => {
  let status = { ...initial };
  vi.mocked(manageContextMenu).mockImplementation(async action => {
    if (action === 'trust') status.certificateTrusted = true;
    if (action === 'enable') status.enabled = true;
    if (action === 'disable') status.enabled = false;
    if (action === 'untrust') status.certificateTrusted = false;
    return { ...status };
  });
  render(<ContextMenuPage />);
  await screen.findByText('ABCD', { exact: false });
  expect(screen.getByRole('button', { name: '启用右键菜单' })).toBeDisabled();
  expect(manageContextMenu).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '信任此证书' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '启用右键菜单' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '启用右键菜单' }));
  await screen.findByRole('button', { name: '停用右键菜单' });
  expect(screen.getByRole('button', { name: '移除证书信任' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '停用右键菜单' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '移除证书信任' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '移除证书信任' }));
  await screen.findByRole('button', { name: '信任此证书' });
  expect(vi.mocked(manageContextMenu).mock.calls.map(([action]) => action)).toEqual(['trust', 'enable', 'disable', 'untrust']);
});

it('keeps the observed disabled state after a failed registration and offers a retry', async () => {
  vi.mocked(getContextMenuStatus).mockResolvedValue({ ...initial, certificateTrusted: true });
  vi.mocked(manageContextMenu).mockRejectedValue(new Error('Deployment failed'));
  render(<ContextMenuPage />);
  await waitFor(() => expect(screen.getByRole('button', { name: '启用右键菜单' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '启用右键菜单' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('无法更新右键菜单');
  expect(screen.getByTestId('context-menu-status')).toHaveTextContent('已关闭');
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
});

it('disables registration when the signed resources are unavailable', async () => {
  vi.mocked(getContextMenuStatus).mockResolvedValue({ ...initial, available: false });
  render(<ContextMenuPage />);
  await screen.findByText('右键菜单资源不可用');
  expect(screen.getByRole('button', { name: '启用右键菜单' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: '信任此证书' })).not.toBeInTheDocument();
});
