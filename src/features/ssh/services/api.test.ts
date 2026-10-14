import { describe, it, expect, vi, beforeEach } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

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
} from '@features/ssh/services/api';

describe('sshApi', () => {
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

  it('passes the confirmed fingerprint when recording host trust', async () => {
    invokeMock.mockResolvedValue(undefined);
    await sshHostKeyInfo('server');
    expect(invokeMock).toHaveBeenCalledWith('ssh_host_key_info', { host: 'server', port: null });
    await sshTrustHostKey('server', 2222, 'SHA256:confirmed');
    expect(invokeMock).toHaveBeenCalledWith('ssh_trust_host_key', { host: 'server', port: 2222, expectedFingerprint: 'SHA256:confirmed' });
  });

  it('validateSshConnection 校验名称/主机/端口', () => {
    expect(validateSshConnection({ name: '', host: 'h' })).toBe('请输入连接名');
    expect(validateSshConnection({ name: 'n', host: '' })).toBe('请输入主机 IP 或域名');
    expect(validateSshConnection({ name: 'n', host: 'h', port: 0 })).toContain('端口');
    expect(validateSshConnection({ name: 'n', host: 'h', port: 70000 })).toContain('端口');
    expect(validateSshConnection({ name: 'n', host: 'h', port: 22 })).toBeNull();
    expect(validateSshConnection({ name: 'n', host: 'h' })).toBeNull();
  });

  it('CRUD 命令映射正确', async () => {
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

  it('sshTest / sshFsList 映射参数', async () => {
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

  it('newSshId 生成唯一 id', () => {
    expect(newSshId()).not.toBe(newSshId());
  });
});
