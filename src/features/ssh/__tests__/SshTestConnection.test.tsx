import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SshFormModal from '@features/ssh/components/SshFormModal';
import type { SshTestResult } from '../services/api';

vi.mock('@features/ssh/services/proxies', () => ({ getProxies: vi.fn().mockResolvedValue({ profiles: [], defaultId: null }) }));

vi.mock('@features/ssh', () => ({
  useSshStore: (selector: (state: { save: () => Promise<void>; remove: () => Promise<void>; connections: [] }) => unknown) =>
    selector({ save: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined), connections: [] }),
}));

vi.mock('../services/api', async importOriginal => {
  const actual = await importOriginal<typeof import('../services/api')>();
  return { ...actual, sshTest: vi.fn(), sshTrustHostKey: vi.fn() };
});

import { sshTest, sshTrustHostKey } from '../services/api';

const success: SshTestResult = { status: 'success', host: 'fresh.example.com', port: 22, message: 'Connection succeeded.' };
const unknown: SshTestResult = { status: 'unknown_host_key', host: 'fresh.example.com', port: 22, keyType: 'ed25519', fingerprint: 'SHA256:fresh-key', message: 'The host key is not trusted yet.' };

function renderForm() {
  return render(<SshFormModal open initial={null} onClose={vi.fn()} />);
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
  vi.mocked(sshTrustHostKey).mockResolvedValue();
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

    await waitFor(() => expect(sshTrustHostKey).toHaveBeenCalledWith(
      'fresh.example.com', 22, 'SHA256:fresh-key', expect.objectContaining({ proxyId: undefined }),
    ));
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
    vi.mocked(sshTest).mockResolvedValue({ status: 'host_key_mismatch', host: 'changed.example.com', port: 22,
      keyType: 'ed25519', fingerprint: 'SHA256:changed-key', message: 'The host key does not match the saved record.' });
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

  it('keeps authentication and network failures as ordinary test feedback', async () => {
    vi.mocked(sshTest).mockResolvedValueOnce({ status: 'auth_failed', host: 'server.example.com', port: 22, message: 'SSH_AUTH_FAILED: rejected' });
    renderForm();
    fillHost('server.example.com');
    await testConnection();
    expect(await screen.findByTestId('ssh-test-result')).toHaveTextContent('认证失败');

    vi.mocked(sshTest).mockResolvedValueOnce({ status: 'network_error', host: 'server.example.com', port: 22, message: '连接超时' });
    fireEvent.click(screen.getByTestId('ssh-test-btn'));
    await waitFor(() => expect(screen.getByTestId('ssh-test-result')).toHaveTextContent('无法连接到 SSH 服务器'));
    expect(screen.queryByTestId('ssh-host-key-prompt')).toBeNull();
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
});
