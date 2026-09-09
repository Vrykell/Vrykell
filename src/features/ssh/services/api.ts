import { invoke } from '@tauri-apps/api/core';
import type { FsEntry } from '@/features/files/services/fs';

/**
 * SSH 连接 API —— 存储与 CRUD 均在后端（SQLite），前端只调用命令。
 * 密码不回显：列表返回 hasPassword 标记，编辑时不回填明文。
 */

export type SshAuthMethod = 'password' | 'key';

export interface SshConnection {
  id: string;
  name: string;
  host: string;
  port?: number;
  user: string;
  password?: string;
  authMethod: SshAuthMethod;
  lastOpenedAt?: number;
  hasPassword?: boolean;
}

export interface SshFsEntry extends FsEntry {}

/** 目录列表响应：条目 + 实际目录的真实路径（空请求 = 远程 home）。 */
export interface SshListResponse {
  entries: SshFsEntry[];
  base: string;
}

/** 表单校验：返回错误信息，合法返回 null。 */
export function validateSshConnection(c: Partial<SshConnection>): string | null {
  if (!c.name || !c.name.trim()) return '请输入连接名';
  if (!c.host || !c.host.trim()) return '请输入主机 IP 或域名';
  if (
    c.port !== undefined &&
    c.port !== null &&
    (!Number.isInteger(c.port) || c.port < 1 || c.port > 65535)
  ) {
    return '端口需为 1-65535 的整数';
  }
  return null;
}

export function listSshConnections(): Promise<SshConnection[]> {
  return invoke('ssh_connections_list');
}

export function saveSshConnection(conn: SshConnection): Promise<void> {
  return invoke('ssh_connection_save', { conn });
}

export function deleteSshConnection(id: string): Promise<void> {
  return invoke('ssh_connection_delete', { id });
}

export function touchSshConnection(id: string): Promise<void> {
  return invoke('ssh_connection_touch', { id });
}

/** 测试连接（显式参数，供表单在保存前测试）。 */
export function sshTest(target: {
  host: string;
  port?: number;
  user: string;
  password?: string;
}): Promise<string> {
  return invoke('ssh_test', {
    host: target.host,
    port: target.port ?? null,
    user: target.user ?? '',
    password: target.password ?? '',
  });
}

/** 查询主机指纹与 known_hosts 记录状态（首次连接确认用）。 */
export function sshHostKeyInfo(
  host: string,
  port?: number,
): Promise<{ fingerprint: string; known: boolean; keyType: string }> {
  return invoke('ssh_host_key_info', { host, port: port ?? null });
}

/** 用户确认指纹后记录主机密钥到 known_hosts（幂等）。 */
export function sshTrustHostKey(host: string, port?: number): Promise<void> {
  return invoke('ssh_trust_host_key', { host, port: port ?? null });
}

/** 列出远程目录（按连接 id，密码由后端解析）。返回条目 + 实际目录真实路径。 */
export function sshFsList(id: string, path?: string): Promise<SshListResponse> {
  return invoke('ssh_list', { id, path: path ?? null });
}

/** 下载远程文件到本地临时目录，返回本地路径（用于系统默认应用打开）。 */
export function sshDownload(id: string, path: string): Promise<string> {
  return invoke('ssh_download', { id, path });
}

export function sshRename(id: string, path: string, newName: string): Promise<void> {
  return invoke('ssh_rename', { id, path, newName });
}

export function sshDelete(id: string, path: string): Promise<void> {
  return invoke('ssh_delete', { id, path });
}

export function sshUpload(id: string, remoteDir: string, localPath: string): Promise<void> {
  return invoke('ssh_upload', { id, remoteDir, localPath });
}

let seq = 0;
/** 生成连接 id（新建时前端生成，后端按 id upsert）。 */
export function newSshId(): string {
  seq += 1;
  return `ssh-${Date.now().toString(36)}-${seq}`;
}
