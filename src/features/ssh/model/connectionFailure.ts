import { t } from '@i18n';

export interface SshConnectionFailure {
  connectionId: string;
  host: string;
  port: number;
  stage: string;
  cause: string;
}

/** Preserve the originating hop when an outer service adds context. */
export function parseSshConnectionFailure(detail: string): SshConnectionFailure | null {
  const prefix = 'SSH_CONNECTION_FAILED:';
  const offset = detail.indexOf(prefix);
  if (offset < 0) return null;
  try {
    const value: unknown = JSON.parse(detail.slice(offset + prefix.length));
    if (!value || typeof value !== 'object') return null;
    const fields = value as Record<string, unknown>;
    if (typeof fields.connectionId !== 'string' || typeof fields.host !== 'string' || typeof fields.port !== 'number'
      || !Number.isInteger(fields.port) || fields.port < 1 || fields.port > 65535 || typeof fields.stage !== 'string' || typeof fields.cause !== 'string') return null;
    return { connectionId: fields.connectionId, host: fields.host, port: fields.port, stage: fields.stage, cause: fields.cause };
  } catch { return null; }
}

export function sshConnectionFailureMessage(detail: string): string | null {
  const failure = parseSshConnectionFailure(detail);
  if (!failure) return null;
  const stages: Record<string, string> = {
    handshake: t('SSH handshake'), 'host-trust': t('Host fingerprint verification'), authentication: t('Authentication'),
    'sftp-open': t('Opening SFTP'), 'resource-collection': t('Resource collection'),
  };
  return t('Connection to {{host}}:{{port}} failed during {{stage}}.', {
    host: failure.host, port: failure.port, stage: stages[failure.stage] ?? t('Connection'),
  });
}
