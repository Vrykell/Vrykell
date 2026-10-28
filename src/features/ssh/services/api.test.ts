import { describe, it, expect, vi, beforeEach } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock, Channel: class { onmessage = (_result: unknown) => {}; } }));

import {
  validateSshConnection,
  listSshConnections,
  saveSshConnection,
  deleteSshConnection,
  touchSshConnection,
  sshTest,
  sshFsList,
  sshStat,
  sshDownload,
  newSshId,
  sshHostKeyInfo,
  sshTrustHostKey,
  sshAuthenticateSession,
  sshNetworkProbe,
  sshSystemStatus,
  sshSearchFiles,
} from '@features/ssh/services/api';
import { diagnosticSnapshot } from '@platform/diagnostics';
import { useHostSystems } from '@config/hostSystems';

describe('sshApi', () => {
  it('records system identity from an existing authenticated status query', async () => {
    invokeMock.mockResolvedValueOnce({ system: 'Linux' });
    await sshSystemStatus('identity-test', 'host.test', 22);
    expect(useHostSystems.getState().systems['identity-test']).toBe('Linux');
    useHostSystems.setState({ systems: {} });
  });
  it('streams file matches before completion and cancels stale requests', async () => {
    let finish!: (result: { entries: never[]; truncated: boolean; skipped: number }) => void;
    invokeMock.mockImplementation(command => command === 'ssh_search' ? new Promise(resolve => { finish = resolve; }) : Promise.resolve());
    const controller = new AbortController();
    const progress = vi.fn();
    const pending = sshSearchFiles('s1', '/project', 'log', controller.signal, progress);
    const args = invokeMock.mock.calls.find(([command]) => command === 'ssh_search')![1] as { requestId: string; onProgress: { onmessage: (result: unknown) => void } };
    const first = { entries: [{ name: 'early.log', path: '/project/early.log', is_dir: false }], truncated: false, skipped: 0 };
    args.onProgress.onmessage(first);
    expect(progress).toHaveBeenCalledWith(first);
    controller.abort();
    expect(invokeMock).toHaveBeenCalledWith('ssh_search_cancel', { requestId: args.requestId });
    args.onProgress.onmessage(first);
    expect(progress).toHaveBeenCalledOnce();
    finish({ entries: [], truncated: false, skipped: 0 });
    await pending;
  });
  it('probes only the supplied TCP endpoint without sending credentials', async () => {
    invokeMock.mockResolvedValue({ dnsMs: 1, attempts: [] });
    await sshNetworkProbe('::1', 2222);
    expect(invokeMock).toHaveBeenCalledWith('ssh_network_probe', { host: '::1', port: 2222 });
  });
  it('keeps legacy full collection compatible and passes explicit dashboard metric selections', async () => {
    invokeMock.mockResolvedValue({});
    await sshSystemStatus('s1', 'server.test', 22);
    expect(invokeMock).toHaveBeenLastCalledWith('ssh_system_status', { id: 's1', host: 'server.test', port: 22, user: null });
    const metrics = { status: false, cpu: true, memory: false, disk: false, network: false, load: false, uptime: false };
    await sshSystemStatus('s1', 'server.test', 22, 'tester', metrics);
    expect(invokeMock).toHaveBeenLastCalledWith('ssh_system_status', { id: 's1', host: 'server.test', port: 22, user: 'tester', metrics });
  });
  it('validates keepalive and jump destinations before saving', () => {
    expect(validateSshConnection({ name: 'n', host: 'h', serverAliveInterval: -1 })).toContain('保活');
    expect(validateSshConnection({ name: 'n', host: 'h', jumpHost: '-oProxyCommand=bad' })).toContain('跳板机');
    expect(validateSshConnection({ name: 'n', host: 'h', jumpHost: 'user@jump.example.com:2222', identityFile: 'C:/Keys/test key', serverAliveInterval: 30 })).toBeNull();
  });

  it('accepts usable port forwards and rejects option-shaped specs', () => {
    expect(validateSshConnection({ name: 'n', host: 'h', localForwards: ['8080:localhost:80', '127.0.0.1:9000:db:5432'] })).toBeNull();
    expect(validateSshConnection({ name: 'n', host: 'h', dynamicForwards: ['1080', '[::]:1081', '[2001:db8::1]:1082'] })).toBeNull();
    expect(validateSshConnection({ name: 'n', host: 'h', remoteForwards: ['-oProxyCommand=x', '-:8080:localhost:80'] })).toContain('远程转发');
    expect(validateSshConnection({ name: 'n', host: 'h', localForwards: ['8080:localhost'] })).toContain('本地转发');
    expect(validateSshConnection({ name: 'n', host: 'h', dynamicForwards: ['70000'] })).toContain('动态转发');
  });
  beforeEach(() => invokeMock.mockReset());

  it('redacts temporary passwords and key passphrases from IPC diagnostics', async () => {
    invokeMock.mockResolvedValue(undefined);
    const target = { connectionId: 's1', host: 'server.test', user: 'tester' };
    await sshAuthenticateSession(target, 'password', 'dummy-password-for-redaction');
    await sshAuthenticateSession(target, 'keyPassphrase', 'dummy-passphrase-for-redaction');
    expect(invokeMock).toHaveBeenCalledWith('ssh_authenticate_session', expect.objectContaining({
      password: 'dummy-password-for-redaction', passphrase: '',
    }));
    expect(invokeMock).toHaveBeenCalledWith('ssh_authenticate_session', expect.objectContaining({
      password: '', passphrase: 'dummy-passphrase-for-redaction',
    }));
    expect(JSON.stringify(diagnosticSnapshot())).not.toContain('dummy-password-for-redaction');
    expect(JSON.stringify(diagnosticSnapshot())).not.toContain('dummy-passphrase-for-redaction');
  });

  it('passes the confirmed fingerprint when recording host trust', async () => {
    invokeMock.mockResolvedValue(undefined);
    await sshHostKeyInfo('server');
    expect(invokeMock).toHaveBeenCalledWith('ssh_host_key_info', { host: 'server', port: null });
    await sshTrustHostKey('server', 2222, 'SHA256:confirmed');
    expect(invokeMock).toHaveBeenCalledWith('ssh_trust_host_key', { host: 'server', port: 2222, expectedFingerprint: 'SHA256:confirmed' });
  });

  it('validateSshConnection validates name/host/port', () => {
    expect(validateSshConnection({ name: '', host: 'h' })).toBe('请输入连接名。');
    expect(validateSshConnection({ name: 'n', host: '' })).toBe('请输入主机 IP 或域名。');
    expect(validateSshConnection({ name: 'n', host: 'h', port: 0 })).toContain('端口');
    expect(validateSshConnection({ name: 'n', host: 'h', port: 70000 })).toContain('端口');
    expect(validateSshConnection({ name: 'n', host: 'h', port: 22 })).toBeNull();
    expect(validateSshConnection({ name: 'n', host: 'h' })).toBeNull();
  });

  it('maps CRUD commands correctly', async () => {
    invokeMock.mockResolvedValue([]);
    await listSshConnections();
    expect(invokeMock).toHaveBeenCalledWith('ssh_connections_list');

    const conn = {
      id: 's1', name: 'n', host: 'h', user: 'root', authMethod: 'password' as const, password: 'p',
    };
    await saveSshConnection(conn);
    expect(invokeMock).toHaveBeenCalledWith('ssh_connection_save', { conn });

    await deleteSshConnection('s1');
    expect(invokeMock).toHaveBeenCalledWith('ssh_connection_delete', { id: 's1' });

    await touchSshConnection('s1');
    expect(invokeMock).toHaveBeenCalledWith('ssh_connection_touch', { id: 's1' });
  });

  it('sshTest / sshFsList map their arguments', async () => {
    invokeMock.mockResolvedValue(undefined);
    await sshTest({ host: 'h', port: 2222, user: 'root', password: 'pw' });
    expect(invokeMock).toHaveBeenCalledWith('ssh_test', {
      host: 'h', port: 2222, user: 'root', password: 'pw',
      options: { identityFile: undefined, jumpHost: undefined, serverAliveInterval: undefined, shellIntegration: undefined,
        localForwards: undefined, remoteForwards: undefined, dynamicForwards: undefined },
    });

    await sshFsList('s1', '/home');
    expect(invokeMock).toHaveBeenCalledWith('ssh_list', { id: 's1', path: '/home' });
    await sshFsList('s1');
    expect(invokeMock).toHaveBeenCalledWith('ssh_list', { id: 's1', path: null });

    await sshStat('s1', '/home/app.log');
    expect(invokeMock).toHaveBeenCalledWith('ssh_stat', { id: 's1', path: '/home/app.log' });

    await sshDownload('s1', '/home/app.log');
    expect(invokeMock).toHaveBeenCalledWith('ssh_download', { id: 's1', path: '/home/app.log' });
  });

  it('newSshId generates unique ids', () => {
    expect(newSshId()).not.toBe(newSshId());
  });
});
