import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SshFormModal from '@features/ssh/components/SshFormModal';
import type { SshConnection, SshTestResult } from '../services/api';

const store = vi.hoisted(() => ({
  save: vi.fn().mockResolvedValue(undefined),
  remove: vi.fn().mockResolvedValue(undefined),
  connections: [] as SshConnection[],
}));

vi.mock('@features/ssh', () => ({
  useSshStore: (selector: (state: typeof store) => unknown) => selector(store),
}));

vi.mock('@features/ssh/services/proxies', () => ({ getProxies: vi.fn().mockResolvedValue({ profiles: [], defaultId: null }) }));

vi.mock('../services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/api')>();
  return { ...actual, sshTest: vi.fn(), sshTrustHostKey: vi.fn(), sshHostKeyInfo: vi.fn() };
});

vi.mock('../services/hostTrust', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/hostTrust')>();
  return { ...actual, prepareSshJumpHosts: vi.fn() };
});

import { sshHostKeyInfo, sshTest, sshTrustHostKey } from '../services/api';
import { prepareSshJumpHosts } from '../services/hostTrust';

const success: SshTestResult = { status: 'success', host: 'fresh.example.com', port: 22, message: 'Connection succeeded.' };
const unknown: SshTestResult = {
  status: 'unknown_host_key',
  host: 'fresh.example.com',
  port: 22,
  keyType: 'ed25519',
  fingerprint: 'SHA256:fresh-key',
  message: 'The host key is not trusted yet.',
};

function renderForm({ initial = null, onClose = vi.fn() }: { initial?: SshConnection | null; onClose?: () => void } = {}) {
  return render(<SshFormModal open initial={initial} onClose={onClose} />);
}

function fillHost(host: string) {
  fireEvent.change(screen.getByTestId('ssh-form-host'), { target: { value: host } });
}

async function testConnection() {
  fireEvent.click(screen.getByTestId('ssh-test-btn'));
}

beforeEach(() => {
  vi.mocked(sshTest).mockReset();
  vi.mocked(sshTrustHostKey).mockReset();
  vi.mocked(sshHostKeyInfo).mockReset();
  vi.mocked(prepareSshJumpHosts).mockReset();
  vi.mocked(sshTrustHostKey).mockResolvedValue();
  store.connections = [];
});

describe('SSH connection test host key states', () => {
  it('shows a first-connection confirmation instead of a failed connection', async () => {
    vi.mocked(sshTest).mockResolvedValue(unknown);
    renderForm();
    fillHost('fresh.example.com');
    await testConnection();

    const prompt = await screen.findByTestId('ssh-host-key-prompt');
    expect(prompt).toHaveTextContent('首次连接，需要确认主机指纹');
    expect(prompt).toHaveTextContent('fresh.example.com:22');
    expect(prompt).toHaveTextContent('ed25519');
    expect(prompt).toHaveTextContent('SHA256:fresh-key');
    expect(prompt).not.toHaveTextContent('SSH_CONNECTION_FAILED');
    expect(screen.queryByTestId('ssh-test-result')).toBeNull();
    expect(screen.getByTestId('ssh-host-key-accept')).toBeEnabled();
    expect(screen.getByTestId('ssh-host-key-cancel')).toBeEnabled();
  });

  it('records the confirmed fingerprint and retests the connection', async () => {
    vi.mocked(sshTest).mockResolvedValueOnce(unknown).mockResolvedValueOnce(success);
    renderForm();
    fillHost('fresh.example.com');
    await testConnection();
    await screen.findByTestId('ssh-host-key-prompt');

    fireEvent.click(screen.getByTestId('ssh-host-key-accept'));

    await waitFor(() =>
      expect(sshTrustHostKey).toHaveBeenCalledWith(
        'fresh.example.com',
        22,
        'SHA256:fresh-key',
        expect.objectContaining({ proxyId: undefined }),
      ),
    );
    expect(vi.mocked(sshTrustHostKey).mock.calls[0][3]).not.toHaveProperty('password');
    expect(await screen.findByTestId('ssh-test-result')).toHaveTextContent('认证成功');
    expect(screen.queryByTestId('ssh-host-key-prompt')).toBeNull();
    expect(sshTest).toHaveBeenCalledTimes(2);
  });

  it('reports an untrusted host after cancelling the confirmation', async () => {
    vi.mocked(sshTest).mockResolvedValue(unknown);
    renderForm();
    fillHost('fresh.example.com');
    await testConnection();
    await screen.findByTestId('ssh-host-key-prompt');

    fireEvent.click(screen.getByTestId('ssh-host-key-cancel'));

    expect(await screen.findByTestId('ssh-test-result')).toHaveTextContent('主机密钥未信任');
    expect(screen.queryByTestId('ssh-host-key-prompt')).toBeNull();
    expect(screen.queryByText('认证失败')).toBeNull();
    expect(sshTrustHostKey).not.toHaveBeenCalled();
  });

  it('warns about a changed host key without offering to trust it', async () => {
    vi.mocked(sshTest).mockResolvedValue({
      status: 'host_key_mismatch',
      host: 'changed.example.com',
      port: 22,
      keyType: 'ed25519',
      fingerprint: 'SHA256:changed-key',
      message: 'The host key does not match the saved record.',
    });
    renderForm();
    fillHost('changed.example.com');
    await testConnection();

    const mismatch = await screen.findByTestId('ssh-host-key-mismatch');
    expect(mismatch).toHaveTextContent('主机密钥不匹配');
    expect(mismatch).toHaveTextContent('中间人攻击');
    expect(mismatch).toHaveTextContent('SHA256:changed-key');
    expect(screen.queryByTestId('ssh-host-key-accept')).toBeNull();
    expect(sshTrustHostKey).not.toHaveBeenCalled();
  });

  it('names the failing jump hop instead of the destination after a changed key', async () => {
    store.connections = [{ id: 'gateway', name: 'Gateway', host: 'gateway.test', port: 2222, user: 'jump-user', authMethod: 'password' }];
    const initial: SshConnection = {
      id: 'destination',
      name: 'Destination',
      host: 'destination.test',
      user: 'deploy',
      authMethod: 'password',
      jumpConnectionId: 'gateway',
    };
    vi.mocked(prepareSshJumpHosts).mockRejectedValueOnce(
      Object.assign(new Error('HOST_KEY_MISMATCH: recorded key changed'), {
        name: 'SshHostKeyMismatchError',
        host: 'gateway.test',
        port: 2222,
        keyType: 'rsa',
        fingerprint: 'SHA256:hop-key',
        rawMessage: 'HOST_KEY_MISMATCH: recorded key changed',
      }),
    );
    renderForm({ initial });
    await testConnection();

    const mismatch = await screen.findByTestId('ssh-host-key-mismatch');
    expect(mismatch).toHaveTextContent('gateway.test:2222');
    expect(mismatch).toHaveTextContent('rsa');
    expect(mismatch).toHaveTextContent('SHA256:hop-key');
    expect(mismatch).not.toHaveTextContent('destination.test');
    expect(sshTest).not.toHaveBeenCalled();
  });

  it('shows the fingerprint the server presents after a failed trust write', async () => {
    vi.mocked(sshTest).mockResolvedValue(unknown);
    vi.mocked(sshTrustHostKey).mockRejectedValueOnce(new Error('HOST_KEY_MISMATCH: recorded key changed'));
    vi.mocked(sshHostKeyInfo).mockResolvedValue({ known: false, mismatch: true, fingerprint: 'SHA256:new-key', keyType: 'rsa' });
    renderForm();
    fillHost('fresh.example.com');
    await testConnection();
    await screen.findByTestId('ssh-host-key-prompt');

    fireEvent.click(screen.getByTestId('ssh-host-key-accept'));

    const mismatch = await screen.findByTestId('ssh-host-key-mismatch');
    expect(mismatch).toHaveTextContent('SHA256:new-key');
    expect(mismatch).not.toHaveTextContent('SHA256:fresh-key');
    expect(sshHostKeyInfo).toHaveBeenCalledWith('fresh.example.com', 22, expect.objectContaining({ proxyId: undefined }));
  });

  it('says the presented fingerprint is unavailable instead of reusing the confirmed one', async () => {
    vi.mocked(sshTest).mockResolvedValue(unknown);
    vi.mocked(sshTrustHostKey).mockRejectedValueOnce(new Error('HOST_KEY_MISMATCH: recorded key changed'));
    vi.mocked(sshHostKeyInfo).mockRejectedValueOnce(new Error('network unavailable'));
    renderForm();
    fillHost('fresh.example.com');
    await testConnection();
    await screen.findByTestId('ssh-host-key-prompt');

    fireEvent.click(screen.getByTestId('ssh-host-key-accept'));

    const mismatch = await screen.findByTestId('ssh-host-key-mismatch');
    expect(mismatch).toHaveTextContent('指纹不可用');
    expect(mismatch).not.toHaveTextContent('SHA256:fresh-key');
  });

  it('keeps authentication and network failures as ordinary test feedback', async () => {
    vi.mocked(sshTest).mockResolvedValueOnce({
      status: 'auth_failed',
      host: 'server.example.com',
      port: 22,
      message: 'SSH_AUTH_FAILED: rejected',
    });
    renderForm();
    fillHost('server.example.com');
    await testConnection();
    expect(await screen.findByTestId('ssh-test-result')).toHaveTextContent('认证失败');

    vi.mocked(sshTest).mockResolvedValueOnce({ status: 'network_error', host: 'server.example.com', port: 22, message: '连接超时' });
    fireEvent.click(screen.getByTestId('ssh-test-btn'));
    await waitFor(() => expect(screen.getByTestId('ssh-test-result')).toHaveTextContent('无法连接到 SSH 服务器'));
    expect(screen.queryByTestId('ssh-host-key-prompt')).toBeNull();
  });

  it('keeps raw backend text in the details of an unexpected failure', async () => {
    const raw =
      'SSH_CONNECTION_FAILED:{"connectionId":"","host":"server.example.com","port":22,"stage":"host-trust","cause":"known_hosts unavailable"}';
    vi.mocked(sshTest).mockResolvedValue({ status: 'other_error', host: 'server.example.com', port: 22, message: raw });
    renderForm();
    fillHost('server.example.com');
    await testConnection();

    const result = await screen.findByTestId('ssh-test-result');
    expect(result).toHaveTextContent('连接 server.example.com:22 时，主机指纹校验阶段失败。');
    expect(result).not.toHaveTextContent('SSH_CONNECTION_FAILED');
    fireEvent.click(screen.getByRole('button', { name: '技术详情' }));
    expect(result).toHaveTextContent(raw);
  });

  it('reports a normal success without host key prompts', async () => {
    vi.mocked(sshTest).mockResolvedValue(success);
    renderForm();
    fillHost('fresh.example.com');
    await testConnection();

    expect(await screen.findByTestId('ssh-test-result')).toHaveTextContent('认证成功');
    expect(screen.queryByTestId('ssh-host-key-prompt')).toBeNull();
    expect(sshTrustHostKey).not.toHaveBeenCalled();
  });

  it('binds the result to the tested target and retests that target', async () => {
    vi.mocked(sshTest)
      .mockResolvedValueOnce({ ...unknown, port: 2222 })
      .mockResolvedValueOnce(success);
    renderForm();
    fillHost('other.example.com');
    await testConnection();

    const prompt = await screen.findByTestId('ssh-host-key-prompt');
    expect(prompt).toHaveTextContent('fresh.example.com:2222');
    expect(screen.getByTestId('ssh-form-host')).toBeDisabled();
    expect(screen.getByTestId('ssh-form-port')).toBeDisabled();

    fireEvent.click(screen.getByTestId('ssh-host-key-accept'));

    await waitFor(() => expect(sshTrustHostKey).toHaveBeenCalledWith('fresh.example.com', 2222, 'SHA256:fresh-key', undefined));
    await waitFor(() => expect(sshTest).toHaveBeenCalledTimes(2));
    expect(vi.mocked(sshTest).mock.calls[1][0]).toMatchObject({ host: 'fresh.example.com', port: 2222 });
  });

  it('clears a stale result when target fields change', async () => {
    vi.mocked(sshTest).mockResolvedValue(success);
    renderForm();
    fillHost('fresh.example.com');
    await testConnection();
    expect(await screen.findByTestId('ssh-test-result')).toHaveTextContent('认证成功');

    fillHost('another.example.com');
    expect(screen.queryByTestId('ssh-test-result')).toBeNull();
  });

  it('keeps Enter and Escape from discarding a pending fingerprint prompt', async () => {
    const onClose = vi.fn();
    vi.mocked(sshTest).mockResolvedValue(unknown);
    renderForm({ onClose });
    fillHost('fresh.example.com');
    await testConnection();

    const accept = await screen.findByTestId('ssh-host-key-accept');
    await waitFor(() => expect(accept).toHaveFocus());

    fireEvent.keyDown(screen.getByTestId('ssh-form-host'), { key: 'Enter' });
    fireEvent.keyDown(document.body, { key: 'Escape' });

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId('ssh-host-key-prompt')).toBeVisible();
    expect(sshTest).toHaveBeenCalledTimes(1);
  });
});
