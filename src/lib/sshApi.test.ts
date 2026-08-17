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
  sshDownload,
  newSshId,
} from '../ssh/api';

describe('sshApi', () => {
  beforeEach(() => invokeMock.mockReset());

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
    });

    await sshFsList('s1', '/home');
    expect(invokeMock).toHaveBeenCalledWith('ssh_list', { id: 's1', path: '/home' });
    await sshFsList('s1');
    expect(invokeMock).toHaveBeenCalledWith('ssh_list', { id: 's1', path: null });

    await sshDownload('s1', '/home/app.log');
    expect(invokeMock).toHaveBeenCalledWith('ssh_download', { id: 's1', path: '/home/app.log' });
  });

  it('newSshId 生成唯一 id', () => {
    expect(newSshId()).not.toBe(newSshId());
  });
});
