import { ask } from '@tauri-apps/plugin-dialog';
import { sshHostKeyInfo, sshTrustHostKey, type SshHostKeyInfo } from './api';
import type { SshOptions } from '@core/ssh';
import { t } from '@i18n';
import type { SshConnection } from './api';
import { savedJumpRoute } from '../model/jumpRoute';

/** Confirm each saved hop before querying the destination through its route. */
export async function prepareSshJumpHosts(options: SshOptions, connections: SshConnection[], signal?: AbortSignal): Promise<void> {
  for (const hop of savedJumpRoute(connections, options.jumpConnectionId)) {
    await prepareSshHost(hop.host, hop.port, signal, hop);
  }
}

/** Stable identity for a host-trust cancellation, independent of the active locale. */
export class SshHostTrustCancelledError extends Error {
  constructor() {
    super(t('SSH connection cancelled'));
    this.name = 'SshHostTrustCancelledError';
  }
}

/** Stable identity for a changed host key, independent of the active locale. */
export class SshHostKeyMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SshHostKeyMismatchError';
  }
}

function hostKeyMismatchMessage(host: string, port?: number): string {
  return t('The host key presented by {{host}}:{{port}} does not match the saved record. This may indicate a man-in-the-middle attack. Nothing was overwritten; verify the server before continuing.', { host, port: port ?? 22 });
}

/** Translate a changed-key failure and never swallow other errors. */
function throwHostKeyMismatch(reason: unknown, host: string, port?: number): never {
  const message = String((reason as Error)?.message ?? reason);
  if (!message.includes('HOST_KEY_MISMATCH')) throw reason;
  throw new SshHostKeyMismatchError(hostKeyMismatchMessage(host, port));
}

export async function prepareSshHost(host: string, port?: number, signal?: AbortSignal, options?: SshOptions): Promise<SshHostKeyInfo> {
  let info: SshHostKeyInfo;
  try {
    info = await (options ? sshHostKeyInfo(host, port, options) : sshHostKeyInfo(host, port));
  } catch (reason) {
    throwHostKeyMismatch(reason, host, port);
  }
  signal?.throwIfAborted();
  if (info.known) return info;
  const confirmed = await ask(
    t('First connection to {{host}}:{{port}}\nKey type: {{keyType}}\nHost fingerprint: {{fingerprint}}\n\nVerify the remote host fingerprint before trusting it.', {
      host, port: port ?? 22, keyType: info.keyType, fingerprint: info.fingerprint,
    }),
    { title: t('Confirm the SSH host fingerprint'), kind: 'warning', okLabel: t('Trust and connect'), cancelLabel: t('Cancel connection') },
  );
  signal?.throwIfAborted();
  if (!confirmed) throw new SshHostTrustCancelledError();
  try {
    await (options ? sshTrustHostKey(host, port, info.fingerprint, options) : sshTrustHostKey(host, port, info.fingerprint));
  } catch (reason) {
    throwHostKeyMismatch(reason, host, port);
  }
  signal?.throwIfAborted();
  return info;
}
