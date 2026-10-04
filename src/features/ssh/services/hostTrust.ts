import { ask } from '@tauri-apps/plugin-dialog';
import { sshHostKeyInfo, sshTrustHostKey, type SshHostKeyInfo } from './api';

export async function prepareSshHost(host: string, port?: number, signal?: AbortSignal): Promise<SshHostKeyInfo> {
  const info = await sshHostKeyInfo(host, port);
  signal?.throwIfAborted();
  if (info.known) return info;
  const confirmed = await ask(
    `首次连接到 ${host}:${port ?? 22}\n密钥类型：${info.keyType}\n主机指纹：${info.fingerprint}\n\n请核对远端主机指纹后确认信任。`,
    { title: '确认 SSH 主机指纹', kind: 'warning', okLabel: '信任并连接', cancelLabel: '取消连接' },
  );
  signal?.throwIfAborted();
  if (!confirmed) throw new Error('已取消 SSH 连接');
  await sshTrustHostKey(host, port, info.fingerprint);
  signal?.throwIfAborted();
  return info;
}
