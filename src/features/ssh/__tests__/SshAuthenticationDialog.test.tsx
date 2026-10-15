import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SshAuthenticationDialog from '../components/SshAuthenticationDialog';
import { requestSshAuthentication, useSessionAuthenticationStore } from '../stores/sessionAuthentication';

const mocks = vi.hoisted(() => ({ authenticate: vi.fn(), forget: vi.fn() }));
vi.mock('../services/api', () => ({ sshAuthenticateSession: mocks.authenticate, sshForgetSessionAuth: mocks.forget }));
const target = { connectionId: 'one', host: 'server.test', user: 'tester', identityFile: '/keys/test' };

beforeEach(() => {
  vi.clearAllMocks(); mocks.authenticate.mockResolvedValue(undefined); mocks.forget.mockResolvedValue(undefined);
  useSessionAuthenticationStore.setState({ request: null, revisions: {}, temporary: {} });
});

describe('temporary SSH authentication', () => {
  it('uses a masked field and shares only an authentication revision after success', async () => {
    requestSshAuthentication(target);
    render(<SshAuthenticationDialog />);
    const input = screen.getByTestId('ssh-session-secret');
    expect(input).toHaveAttribute('type', 'password');
    fireEvent.change(input, { target: { value: 'test-password' } });
    expect(JSON.stringify(useSessionAuthenticationStore.getState())).not.toContain('test-password');
    fireEvent.click(screen.getByRole('button', { name: '认证' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mocks.authenticate).toHaveBeenCalledWith(expect.objectContaining(target), 'password', 'test-password');
    expect(useSessionAuthenticationStore.getState()).toMatchObject({ revisions: { one: 1 }, temporary: { one: true } });
  });

  it('clears a rejected secret and prevents duplicate submissions', async () => {
    let reject!: (reason: Error) => void;
    mocks.authenticate.mockReturnValue(new Promise((_resolve, fail) => { reject = fail; }));
    requestSshAuthentication(target); render(<SshAuthenticationDialog />);
    fireEvent.change(screen.getByTestId('ssh-session-secret'), { target: { value: 'wrong-password' } });
    const submit = screen.getByRole('button', { name: '认证' });
    fireEvent.click(submit); fireEvent.click(submit);
    expect(mocks.authenticate).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('ssh-session-secret')).toHaveValue('');
    await act(async () => reject(new Error('SSH_AUTH_FAILED: rejected')));
    expect(await screen.findByText('请检查服务器密码或私钥解密口令后重试。')).toBeVisible();
    expect(useSessionAuthenticationStore.getState().temporary).toEqual({});
  });

  it('sends a key passphrase separately from a server password', async () => {
    requestSshAuthentication(target); render(<SshAuthenticationDialog />);
    fireEvent.click(screen.getByRole('combobox', { name: '认证方式' }));
    fireEvent.click(screen.getByRole('option', { name: '私钥解密口令' }));
    fireEvent.change(screen.getByTestId('ssh-session-secret'), { target: { value: 'test-passphrase' } });
    fireEvent.keyDown(screen.getByTestId('ssh-session-secret'), { key: 'Enter' });
    await waitFor(() => expect(mocks.authenticate).toHaveBeenCalledWith(expect.objectContaining(target), 'keyPassphrase', 'test-passphrase'));
  });

  it('cancels without sending a credential and clears temporary authentication explicitly', async () => {
    requestSshAuthentication(target); render(<SshAuthenticationDialog />);
    fireEvent.change(screen.getByTestId('ssh-session-secret'), { target: { value: 'unused-secret' } });
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(mocks.authenticate).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    act(() => { useSessionAuthenticationStore.setState({ temporary: { one: true } }); requestSshAuthentication(target); });
    fireEvent.click(screen.getByRole('button', { name: '清除临时凭据' }));
    await waitFor(() => expect(mocks.forget).toHaveBeenCalledWith('one'));
    expect(useSessionAuthenticationStore.getState().request).toBeNull();
  });
});
