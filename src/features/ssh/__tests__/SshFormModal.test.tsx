import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SshFormModal from '@features/ssh/components/SshFormModal';
vi.mock('@features/ssh/services/proxies', () => ({ getProxies: vi.fn().mockResolvedValue({ profiles: [], defaultId: null }) }));

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
    fireEvent.click(screen.getByRole('radio', { name: '密钥' }));
    fireEvent.change(screen.getByTestId('ssh-form-identity'), { target: { value: 'C:/private/key' } });
    expect(screen.queryByTestId('ssh-section-tab-advanced')).toBeNull();
    fireEvent.change(screen.getByTestId('ssh-form-jump'), { target: { value: 'user@jump:2222' } });
    fireEvent.change(screen.getByTestId('ssh-form-keepalive'), { target: { value: '45' } });
    fireEvent.click(screen.getByTestId('ssh-connect-btn'));
    await waitFor(() => expect(onConnect).toHaveBeenCalledWith(expect.objectContaining({
      name: 'tester@target', identityFile: 'C:/private/key', jumpHost: 'user@jump:2222',
      serverAliveInterval: 45, shellIntegration: false,
    })));
  });
  it('keeps port forwards and automatic reconnect in the connection read from the form', async () => {
    const onConnect = vi.fn();
    render(<SshFormModal open initial={null} onClose={vi.fn()} onConnect={onConnect} />);
    fireEvent.change(screen.getByTestId('ssh-form-host'), { target: { value: 'target' } });
    expect(screen.queryByTestId('ssh-section-tab-forwarding')).toBeNull();
    fireEvent.click(screen.getByRole('combobox', { name: '转发编辑模式' }));
    fireEvent.click(screen.getByRole('option', { name: '文本模式' }));
    // Blank lines and surrounding spaces are dropped; one specification per line.
    fireEvent.change(screen.getByTestId('ssh-form-local-forward'), { target: { value: '8080:localhost:80\n\n  9090:db:5432  \n' } });
    fireEvent.change(screen.getByTestId('ssh-form-dynamic-forward'), { target: { value: '1080' } });
    expect(screen.queryByTestId('ssh-section-tab-advanced')).toBeNull();
    fireEvent.click(screen.getByTestId('ssh-form-auto-reconnect'));
    fireEvent.click(screen.getByTestId('ssh-connect-btn'));
    await waitFor(() => expect(onConnect).toHaveBeenCalledWith(expect.objectContaining({
      localForwards: ['8080:localhost:80', '9090:db:5432'],
      dynamicForwards: ['1080'],
      remoteForwards: undefined,
      autoReconnect: true,
    })));
  });

  it('focuses the host for quick connection, traps Tab and cancels on Escape', async () => {
    const onClose = vi.fn();
    render(<SshFormModal open initial={null} onClose={onClose} onConnect={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('ssh-form-host')).toHaveFocus());
    screen.getByTestId('ssh-connect-btn').focus();
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
    expect(screen.getByTestId('ssh-form-name')).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });
  it('builds a GUI rule and preserves it when switching to text mode and back', async () => {
    const onConnect = vi.fn();
    render(<SshFormModal open initial={null} onClose={vi.fn()} onConnect={onConnect} />);
    fireEvent.change(screen.getByTestId('ssh-form-host'), { target: { value: 'target' } });
    expect(screen.queryByTestId('ssh-section-tab-forwarding')).toBeNull();
    fireEvent.click(screen.getByTestId('ssh-forward-add'));
    fireEvent.change(screen.getByTestId('ssh-forward-port-0'), { target: { value: '8080' } });
    fireEvent.change(screen.getByTestId('ssh-forward-target-port-0'), { target: { value: '80' } });
    fireEvent.click(screen.getByRole('combobox', { name: '转发编辑模式' }));
    fireEvent.click(screen.getByRole('option', { name: '文本模式' }));
    expect(screen.getByTestId('ssh-form-local-forward')).toHaveValue('8080:localhost:80');
    fireEvent.click(screen.getByRole('combobox', { name: '转发编辑模式' }));
    fireEvent.click(screen.getByRole('option', { name: '图形模式' }));
    expect(screen.getByTestId('ssh-forward-port-0')).toHaveValue('8080');
    fireEvent.click(screen.getByTestId('ssh-connect-btn'));
    await waitFor(() => expect(onConnect).toHaveBeenCalledWith(expect.objectContaining({ localForwards: ['8080:localhost:80'] })));
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
