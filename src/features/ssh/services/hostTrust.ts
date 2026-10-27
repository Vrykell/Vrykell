import { ask } from '@tauri-apps/plugin-dialog';
import { sshHostKeyInfo, sshTrustHostKey, type SshHostKeyInfo } from './api';
import type { SshOptions } from '@core/ssh';
import { t } from '@i18n';

export async function prepareSshHost(host: string, port?: number, signal?: AbortSignal, options?: SshOptions): Promise<SshHostKeyInfo> {
  const info = await (options ? sshHostKeyInfo(host, port, options) : sshHostKeyInfo(host, port));
  signal?.throwIfAborted();
  if (info.known) return info;
  const confirmed = await ask(
    t('First connection to {{host}}:{{port}}\nKey type: {{keyType}}\nHost fingerprint: {{fingerprint}}\n\nVerify the remote host fingerprint before trusting it.', {
      host, port: port ?? 22, keyType: info.keyType, fingerprint: info.fingerprint,
    }),
    { title: t('Confirm the SSH host fingerprint'), kind: 'warning', okLabel: t('Trust and connect'), cancelLabel: t('Cancel connection') },
  );
  signal?.throwIfAborted();
  if (!confirmed) throw new Error(t('SSH connection cancelled'));
  await (options ? sshTrustHostKey(host, port, info.fingerprint, options) : sshTrustHostKey(host, port, info.fingerprint));
  signal?.throwIfAborted();
  return info;
}
