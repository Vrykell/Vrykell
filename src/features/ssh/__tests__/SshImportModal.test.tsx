import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  candidates: vi.fn(),
  save: vi.fn(),
  connections: [] as Array<Record<string, unknown>>,
  toasts: [] as Array<{ message: string; kind: string }>,
}));

vi.mock('@features/ssh/services/api', () => ({
  sshConfigCandidates: mocks.candidates,
  newSshId: () => 'ssh-imported',
  validateSshConnection: () => null,
}));
vi.mock('@features/ssh', () => ({
  useSshStore: Object.assign(
    (selector: (state: { save: () => Promise<void> }) => unknown) => selector({ save: mocks.save }),
    { getState: () => ({ connections: mocks.connections }) },
  ),
}));
vi.mock('@ui/feedback/Toast', () => ({
  useToastStore: {
    getState: () => ({
      addToast: (message: string, kind: string) => mocks.toasts.push({ message, kind }),
    }),
  },
}));

import SshImportModal from '@features/ssh/components/SshImportModal';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.save.mockResolvedValue(undefined);
  mocks.connections = [];
  mocks.toasts.length = 0;
  mocks.candidates.mockResolvedValue([
    { name: 'web', host: '10.0.0.5', user: 'deploy', port: 2222, identityFile: '/keys/web' },
    { name: 'db', host: 'db.internal' },
  ]);
});

describe('SSH config import', () => {
  it('pre-selects the aliases a saved connection does not cover yet', async () => {
    mocks.connections = [{ host: '10.0.0.5', port: 2222, user: 'deploy' }];
    render(<SshImportModal open onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByTestId('ssh-import-db')).toBeInTheDocument());
    expect(screen.getByTestId('ssh-import-db')).toBeChecked();
    expect(screen.getByTestId('ssh-import-web')).not.toBeChecked();
    expect(screen.getByTestId('ssh-import-web')).toBeDisabled();
    expect(screen.getByText(/已存在/)).toBeInTheDocument();
  });

  it('saves each selected alias as a connection and reports the count', async () => {
    const onClose = vi.fn();
    render(<SshImportModal open onClose={onClose} />);

    await waitFor(() => expect(screen.getByTestId('ssh-import-db')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('ssh-import-confirm'));

    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({
      name: 'web', host: '10.0.0.5', user: 'deploy', port: 2222,
      identityFile: '/keys/web', authMethod: 'key',
    }));
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({
      name: 'db', host: 'db.internal', authMethod: 'password',
    }));
    await waitFor(() => expect(mocks.toasts[mocks.toasts.length - 1]).toEqual({ message: '已导入 2 个连接', kind: 'success' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('keeps failures selected and retries only failed hosts', async () => {
    const onClose = vi.fn();
    mocks.save.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Save denied'));
    render(<SshImportModal open onClose={onClose} />);
    await waitFor(() => expect(screen.getByTestId('ssh-import-db')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('ssh-import-confirm'));
    await waitFor(() => expect(screen.getByText('Save denied')).toBeVisible());
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId('ssh-import-web')).toBeDisabled();
    expect(screen.getByTestId('ssh-import-db')).toBeChecked();
    expect(screen.getByText(/已导入 1 项，失败 1 项/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '重试失败项' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(mocks.save).toHaveBeenCalledTimes(3);
    expect(mocks.save.mock.calls[2][0].name).toBe('db');
  });

  it('surfaces a read failure inline instead of the list', async () => {
    mocks.candidates.mockRejectedValue(new Error('读取 SSH 配置失败：permission denied'));
    render(<SshImportModal open onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('读取 SSH 配置失败')).toBeInTheDocument());
    expect(screen.queryByTestId('ssh-import-list')).toBeNull();
  });
});
