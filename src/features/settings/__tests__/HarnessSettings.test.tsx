import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
const ipc = vi.hoisted(() => ({ list: vi.fn(), save: vi.fn() }));
vi.mock('@platform/api/acp', () => ({ acpHarnesses: ipc.list, acpHarnessSave: ipc.save, acpHandshake: vi.fn() }));
vi.mock('@platform/diagnostics', () => ({ invoke: vi.fn(async () => true), diagnostic: vi.fn() }));
import HarnessPage from '../pages/harnessPage';
import HarnessDialog from '../components/HarnessDialog';
import { SettingsSaveProvider } from '../components/SettingsSaveProvider';
import { useUsageSources } from '@features/agent';

const server = { name: 'Agent', command: 'runner', args: ['path with spaces', '--flag'], enabled: true, env: {}, cwd: '' };
beforeEach(() => {
  ipc.list.mockResolvedValue([server]); ipc.save.mockReset().mockResolvedValue(undefined);
  useUsageSources.getState().replace([]);
});

it('preserves argument boundaries and keeps the editor open until persistence succeeds', async () => {
  const save = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  const close = vi.fn();
  render(<HarnessDialog open entry={server} onSave={save} onClose={close} />);
  expect(screen.getByTestId('harness-dialog-args')).toHaveValue('path with spaces\n--flag');
  fireEvent.click(screen.getByTestId('harness-dialog-save'));
  await screen.findByText('无法保存服务器，已保留你的修改，请重试。');
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId('harness-dialog-save'));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(save).toHaveBeenLastCalledWith(server);
});

it('persists a new server before leaving its editor without a debounce window', async () => {
  let finish: (() => void) | undefined;
  ipc.save.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  render(<SettingsSaveProvider><HarnessPage /></SettingsSaveProvider>);
  await screen.findByTestId('harness-row-0');
  expect(useUsageSources.getState().configured).toEqual(['Agent']);
  fireEvent.click(screen.getByTestId('harness-add'));
  fireEvent.change(screen.getByTestId('harness-dialog-name'), { target: { value: 'New agent' } });
  fireEvent.change(screen.getByTestId('harness-dialog-command'), { target: { value: 'runner' } });
  fireEvent.click(screen.getByTestId('harness-dialog-save'));
  await waitFor(() => expect(ipc.save).toHaveBeenCalledOnce());
  expect(screen.getByTestId('harness-dialog')).toBeInTheDocument();
  expect(screen.getByTestId('harness-dialog-save')).toBeDisabled();
  expect(useUsageSources.getState().configured).toEqual(['Agent']);
  finish!();
  await waitFor(() => expect(screen.queryByTestId('harness-dialog')).not.toBeInTheDocument());
  expect(screen.getByTestId('harness-row-1')).toHaveTextContent('New agent');
  expect(useUsageSources.getState().configured).toEqual(['Agent', 'New agent']);
});

it('does not add an unsaved configuration to usage sources', async () => {
  ipc.save.mockRejectedValueOnce(new Error('Unavailable'));
  render(<SettingsSaveProvider><HarnessPage /></SettingsSaveProvider>);
  await screen.findByTestId('harness-row-0');
  fireEvent.click(screen.getByTestId('harness-add'));
  fireEvent.change(screen.getByTestId('harness-dialog-name'), { target: { value: 'Unsaved agent' } });
  fireEvent.change(screen.getByTestId('harness-dialog-command'), { target: { value: 'runner' } });
  fireEvent.click(screen.getByTestId('harness-dialog-save'));
  await screen.findByText('无法保存服务器，已保留你的修改，请重试。');
  expect(useUsageSources.getState().configured).toEqual(['Agent']);
});

it('shows a configuration failure with retry instead of reporting an empty list', async () => {
  ipc.list.mockRejectedValueOnce(new Error('unavailable'));
  render(<SettingsSaveProvider><HarnessPage /></SettingsSaveProvider>);
  await screen.findByText('无法加载服务器');
  expect(screen.queryByTestId('harness-none')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  await screen.findByTestId('harness-row-0');
});
