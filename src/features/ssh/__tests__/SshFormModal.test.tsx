import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SshFormModal from '@features/ssh/components/SshFormModal';

vi.mock('@features/ssh', () => ({
  useSshStore: (selector: (state: { save: () => Promise<void>; remove: () => Promise<void> }) => unknown) =>
    selector({ save: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined) }),
}));

describe('SSH form dismissal', () => {
  it('quick connects with private key, jump host and keepalive without saving a connection', async () => {
    const onConnect = vi.fn();
    render(<SshFormModal open initial={null} onClose={vi.fn()} onConnect={onConnect} />);
    fireEvent.change(screen.getByTestId('ssh-form-host'), { target: { value: 'target' } });
    fireEvent.change(screen.getByTestId('ssh-form-user'), { target: { value: 'tester' } });
    fireEvent.click(screen.getByRole('button', { name: /^密钥$/ }));
    fireEvent.change(screen.getByTestId('ssh-form-identity'), { target: { value: 'C:/private/key' } });
    fireEvent.change(screen.getByTestId('ssh-form-jump'), { target: { value: 'user@jump:2222' } });
    fireEvent.change(screen.getByTestId('ssh-form-keepalive'), { target: { value: '45' } });
    fireEvent.click(screen.getByTestId('ssh-connect-btn'));
    await waitFor(() => expect(onConnect).toHaveBeenCalledWith(expect.objectContaining({
      name: 'tester@target', identityFile: 'C:/private/key', jumpHost: 'user@jump:2222',
      serverAliveInterval: 45, shellIntegration: false,
    })));
  });
  it('keeps the form open while editing and closes on an explicit cancellation or backdrop click', () => {
    const onClose = vi.fn();
    render(<SshFormModal open initial={null} onClose={onClose} />);
    fireEvent.change(screen.getByTestId('ssh-form-name'), { target: { value: '尚未填写完成' } });
    fireEvent.change(screen.getByTestId('ssh-form-host'), { target: { value: 'test.invalid' } });
    fireEvent.click(screen.getByTestId('ssh-form-host'));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId('ssh-form-name')).toHaveValue('尚未填写完成');
    expect(screen.getByTestId('ssh-form-host')).toHaveValue('test.invalid');
    fireEvent.click(screen.getByRole('button', { name: /^取消$/ }));
    expect(onClose).toHaveBeenCalledOnce();
    onClose.mockClear();
    fireEvent.click(screen.getByRole('dialog', { name: 'SSH 连接' }).parentElement!);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
