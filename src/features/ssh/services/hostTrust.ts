import { ask } from '@tauri-apps/plugin-dialog';
import { sshHostKeyInfo, sshTrustHostKey, sshConnectionOptions, type SshHostKeyInfo } from './api';
import type { SshOptions } from '@core/ssh';
import { t } from '@i18n';
import type { SshConnection } from './api';
import { savedJumpRoute } from '../model/jumpRoute';

/** Address and key details of the endpoint whose host key changed. */
export interface SshHostKeyMismatchDetails {
  host: string;
  port: number;
  keyType?: string;
  fingerprint?: string;
  rawMessage?: string;
  options?: SshOptions;
}

/** Stable identity for a changed host key, independent of the active locale. */
export class SshHostKeyMismatchError extends Error {
  readonly host: string;
  readonly port: number;
  readonly keyType?: string;
  readonly fingerprint?: string;
  readonly rawMessage?: string;
  readonly options?: SshOptions;
  constructor(details: SshHostKeyMismatchDetails) {
    super(hostKeyMismatchMessage(details.host, details.port));
    this.name = 'SshHostKeyMismatchError';
    this.host = details.host;
    this.port = details.port;
    this.keyType = details.keyType;
    this.fingerprint = details.fingerprint;
    this.rawMessage = details.rawMessage;
    this.options = details.options;
  }
}

/** Stable identity for a host-trust cancellation, independent of the active locale. */
export class SshHostTrustCancelledError extends Error {
  readonly host: string;
  readonly port: number;
  constructor(host: string, port?: number) {
    super(t('SSH connection cancelled'));
    this.name = 'SshHostTrustCancelledError';
    this.host = host;
    this.port = port ?? 22;
  }
}

function hostKeyMismatchMessage(host: string, port?: number): string {
  return t('The host key presented by {{host}}:{{port}} does not match the saved record. This may indicate a man-in-the-middle attack. Nothing was overwritten; verify the server before continuing.', { host, port: port ?? 22 });
}

function failureText(reason: unknown): string {
  return String((reason as Error)?.message ?? reason);
}

/** Translate a changed-key failure and never swallow other errors. */
function throwHostKeyMismatch(reason: unknown, host: string, port: number | undefined, options?: SshOptions, details: { keyType?: string; fingerprint?: string } = {}): never {
  const message = failureText(reason);
  if (!message.includes('HOST_KEY_MISMATCH')) throw reason;
  throw new SshHostKeyMismatchError({ host, port: port ?? 22, keyType: details.keyType, fingerprint: details.fingerprint, rawMessage: message, options });
}

/** Confirm each saved hop before querying the destination through its route. */
export async function prepareSshJumpHosts(options: SshOptions, connections: SshConnection[], signal?: AbortSignal): Promise<void> {
  for (const hop of savedJumpRoute(connections, options.jumpConnectionId)) {
    try {
      await prepareSshHost(hop.host, hop.port, signal, hop);
    } catch (reason) {
      // Keep the warning attached to the hop that actually failed, not the destination.
      if (reason instanceof SshHostKeyMismatchError) {
        throw new SshHostKeyMismatchError({ host: hop.host, port: hop.port ?? 22, keyType: reason.keyType,
          fingerprint: reason.fingerprint, rawMessage: reason.rawMessage, options: sshConnectionOptions(hop) });
      }
      throw reason;
    }
  }
}

export async function prepareSshHost(host: string, port?: number, signal?: AbortSignal, options?: SshOptions): Promise<SshHostKeyInfo> {
  const safeOptions = options ? sshConnectionOptions(options) : undefined;
  let info: SshHostKeyInfo;
  try {
    info = await (safeOptions ? sshHostKeyInfo(host, port, safeOptions) : sshHostKeyInfo(host, port));
  } catch (reason) {
    throwHostKeyMismatch(reason, host, port, safeOptions);
  }
  signal?.throwIfAborted();
  if (info.mismatch) {
    throw new SshHostKeyMismatchError({ host, port: port ?? 22, keyType: info.keyType, fingerprint: info.fingerprint, options: safeOptions });
  }
  if (info.known) return info;
  const confirmed = await ask(
    t('First connection to {{host}}:{{port}}\nKey type: {{keyType}}\nHost fingerprint: {{fingerprint}}\n\nVerify the remote host fingerprint before trusting it.', {
      host, port: port ?? 22, keyType: info.keyType, fingerprint: info.fingerprint,
    }),
    { title: t('Confirm the SSH host fingerprint'), kind: 'warning', okLabel: t('Trust and connect'), cancelLabel: t('Cancel connection') },
  );
  signal?.throwIfAborted();
  if (!confirmed) throw new SshHostTrustCancelledError(host, port);
  try {
    await (safeOptions ? sshTrustHostKey(host, port, info.fingerprint, safeOptions) : sshTrustHostKey(host, port, info.fingerprint));
  } catch (reason) {
    throwHostKeyMismatch(reason, host, port, safeOptions, { keyType: info.keyType });
  }
  signal?.throwIfAborted();
  return info;
}
