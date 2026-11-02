import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SshAuthenticationDialog from '../components/SshAuthenticationDialog';
import { requestSshAuthentication, useSessionAuthenticationStore } from '../stores/sessionAuthentication';
import { useSshStore } from '../stores/store';
import { prepareSshHost } from '../services/hostTrust';
import type { SshAuthenticationChallenge, SshChallengeReply } from '../services/api';

const mocks = vi.hoisted(() => ({ authenticate: vi.fn(), interactive: vi.fn(), forget: vi.fn() }));
vi.mock('../services/api', () => ({ sshAuthenticateSession: mocks.authenticate, sshAuthenticateInteractive: mocks.interactive, sshForgetSessionAuth: mocks.forget }));
vi.mock('../services/hostTrust', () => ({ prepareSshHost: vi.fn().mockResolvedValue({ known: true }) }));
const target = { connectionId: 'one', host: 'server.test', user: 'tester', identityFile: '/keys/test' };

beforeEach(() => {
  vi.clearAllMocks(); mocks.authenticate.mockResolvedValue(undefined); mocks.forget.mockResolvedValue(undefined);
  useSessionAuthenticationStore.setState({ request: null, revisions: {}, temporary: {} });
  useSshStore.setState({ connections: [] });
});

describe('temporary SSH authentication', () => {
  it('handles host trust and multiple challenges with independent echo settings, then shares only a revision', async () => {
    let challenge!: (challenge: SshAuthenticationChallenge, reply: SshChallengeReply) => void;
    let finish!: () => void;
    mocks.interactive.mockImplementation((_target, _signal, onChallenge) => { challenge = onChallenge; return new Promise<void>(resolve => { finish = resolve; }); });
    requestSshAuthentication(target); render(<SshAuthenticationDialog />);
    fireEvent.click(screen.getByRole('combobox', { name: '认证方式' }));
    fireEvent.click(screen.getByRole('option', { name: '服务器交互验证（MFA）' }));
    fireEvent.click(screen.getByRole('button', { name: '认证' }));
    const hop = { connectionId: 'gateway', host: 'gateway.test', port: 2222, user: 'gateway-user' };
    const trusted = vi.fn().mockResolvedValue(undefined);
    act(() => challenge({ kind: 'hostKey', round: 1, target: hop, fingerprint: 'SHA256:fixture', keyType: 'ed25519' }, trusted));
    expect(screen.getByText('gateway-user@gateway.test:2222')).toBeVisible();
    expect(screen.getByDisplayValue('ed25519 SHA256:fixture')).toHaveAttribute('readonly');
    fireEvent.click(screen.getByRole('button', { name: '信任并连接' }));
    await waitFor(() => expect(trusted).toHaveBeenCalledWith(['SHA256:fixture']));
    const answered = vi.fn().mockResolvedValue(undefined);
    act(() => challenge({ kind: 'prompts', round: 2, target: hop, instructions: '<b>Server instructions</b>', prompts: [{ text: 'Account:', echo: true }, { text: 'Password:', echo: false }] }, answered));
    expect(screen.getByText('<b>Server instructions</b>')).toBeVisible();
    expect(screen.getByLabelText('Account:')).toHaveAttribute('type', 'text');
    expect(screen.getByLabelText('Password:')).toHaveAttribute('type', 'password');
    fireEvent.change(screen.getByLabelText('Account:'), { target: { value: 'temporary-user' } });
    fireEvent.change(screen.getByLabelText('Password:'), { target: { value: 'temporary-answer' } });
    answered.mockImplementationOnce(async () => {
      challenge({ kind: 'prompts', round: 3, target: { ...hop, host: target.host }, instructions: '', prompts: [{ text: 'One-time code:', echo: false }] }, answered);
    });
    fireEvent.keyDown(screen.getByLabelText('Password:'), { key: 'Enter' });
    await waitFor(() => expect(answered).toHaveBeenCalledWith(['temporary-user', 'temporary-answer']));
    expect(screen.getByLabelText('One-time code:')).toHaveValue('');
    await waitFor(() => expect(screen.getByLabelText('One-time code:')).toHaveFocus());
    fireEvent.change(screen.getByLabelText('One-time code:'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    await waitFor(() => expect(answered).toHaveBeenLastCalledWith(['123456']));
    await act(async () => finish());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(useSessionAuthenticationStore.getState()).toMatchObject({ revisions: { one: 1 }, temporary: { one: true } });
    expect(JSON.stringify(useSessionAuthenticationStore.getState())).not.toMatch(/temporary-answer|123456/);
    expect(prepareSshHost).not.toHaveBeenCalled();
  });

  it('starts an interactive route at the destination and cancels pending work with Escape', async () => {
    let signal!: AbortSignal;
    let finish!: () => void;
    mocks.interactive.mockImplementation((_target, active) => { signal = active; return new Promise<void>(resolve => { finish = resolve; }); });
    useSshStore.setState({ connections: [
      { id: 'gateway', name: 'Gateway', host: 'gateway.test', user: 'jump-user', authMethod: 'ask' },
      { id: 'one', name: 'Internal', host: target.host, user: target.user, authMethod: 'ask', jumpConnectionId: 'gateway' },
    ] });
    requestSshAuthentication(target); render(<SshAuthenticationDialog />);
    fireEvent.click(screen.getByRole('combobox', { name: '认证方式' }));
    fireEvent.click(screen.getByRole('option', { name: '服务器交互验证（MFA）' }));
    expect(screen.getByRole('combobox', { name: '认证目标' })).toHaveTextContent('Internal');
    fireEvent.click(screen.getByRole('button', { name: '认证' }));
    expect(mocks.interactive).toHaveBeenCalledWith(expect.objectContaining(target), expect.any(AbortSignal), expect.any(Function));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(signal.aborted).toBe(true);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await act(async () => finish());
    expect(useSessionAuthenticationStore.getState().temporary).toEqual({});
  });
  it('authenticates each hop before the destination and retains separate credentials and revisions', async () => {
    useSshStore.setState({ connections: [
      { id: 'gateway', name: 'Gateway', host: 'gateway.test', user: 'gateway-user', authMethod: 'password' },
      { id: 'one', name: 'Internal', host: target.host, user: target.user, authMethod: 'password', jumpConnectionId: 'gateway' },
    ] });
    requestSshAuthentication(target); render(<SshAuthenticationDialog />);
    expect(screen.getByRole('combobox', { name: '认证目标' })).toHaveTextContent('Gateway');
    fireEvent.change(screen.getByTestId('ssh-session-secret'), { target: { value: 'gateway-test-password' } });
    fireEvent.click(screen.getByRole('button', { name: '认证' }));
    await waitFor(() => expect(screen.getByRole('combobox', { name: '认证目标' })).toHaveTextContent('Internal'));
    expect(mocks.authenticate).toHaveBeenCalledWith(expect.objectContaining({ connectionId: 'gateway', user: 'gateway-user' }), 'password', 'gateway-test-password');
    expect(screen.getByTestId('ssh-session-secret')).toHaveValue('');
    expect(useSessionAuthenticationStore.getState()).toMatchObject({ temporary: { gateway: true }, revisions: { gateway: 1 } });
    fireEvent.change(screen.getByTestId('ssh-session-secret'), { target: { value: 'destination-test-password' } });
    fireEvent.click(screen.getByRole('button', { name: '认证' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mocks.authenticate).toHaveBeenLastCalledWith(expect.objectContaining({ connectionId: 'one', user: 'tester' }), 'password', 'destination-test-password');
    expect(prepareSshHost).toHaveBeenCalledTimes(2);
    expect(useSessionAuthenticationStore.getState()).toMatchObject({ temporary: { gateway: true, one: true }, revisions: { gateway: 1, one: 1 } });
    expect(JSON.stringify(useSessionAuthenticationStore.getState())).not.toContain('test-password');
  });
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
