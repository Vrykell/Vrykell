import { t } from '@i18n';
import { useHostSystems } from '@config/hostSystems';
import { Channel } from '@tauri-apps/api/core';
import { invoke } from '@platform/diagnostics';
import type { FsEntry, FileStat } from '@platform/api/types';
import type { SshAuthenticationTarget, SshOptions } from '@core/ssh';

/**
 * SSH connection API — storage and CRUD live in the backend (database); the frontend only calls commands.
 * Passwords are never echoed: the list returns a hasPassword flag and the editor does not prefill the plaintext.
 */

export type SshAuthMethod = 'password' | 'key' | 'ask' | 'agent';

export interface SshConnection extends SshOptions {
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

/** Directory listing response: entries + the real path of the actual directory (empty request = remote home). */
export interface SshListResponse {
  entries: SshFsEntry[];
  base: string;
}

/** One host alias read from the user's SSH config file. */
export interface SshConfigCandidate {
  name: string;
  host: string;
  user?: string;
  port?: number;
  identityFile?: string;
  jumpHost?: string;
  localForwards?: string[];
  remoteForwards?: string[];
  dynamicForwards?: string[];
}

/** `[bind:]port:host:hostport`, the shape the client accepts for a static forward. */
const FORWARD_HOST = String.raw`(?:\[[0-9a-fA-F:]+\]|[\w.][\w.-]*)`;
const STATIC_FORWARD = new RegExp(`^(?:${FORWARD_HOST}:)?(\\d{1,5}):${FORWARD_HOST}:(\\d{1,5})$`);
/** `[bind:]port`, a local SOCKS listener. */
const DYNAMIC_FORWARD = new RegExp(`^(?:${FORWARD_HOST}:)?(\\d{1,5})$`);

/** Form validation: returns an error message, or null when valid. */
export function validateSshConnection(c: Partial<SshConnection>): string | null {
  if (!c.name || !c.name.trim()) return t('Enter a connection name.');
  if (!c.host || !c.host.trim()) return t('Enter a host IP or domain.');
  if (c.host.startsWith('-') || /\s/.test(c.host)) return t('The host cannot contain spaces or start with a dash.');
  if (c.user?.startsWith('-') || /\s/.test(c.user ?? '')) return t('The account cannot contain spaces or start with a dash.');
  if (c.serverAliveInterval !== undefined && (!Number.isInteger(c.serverAliveInterval) || c.serverAliveInterval < 0 || c.serverAliveInterval > 3600)) return t('Keepalive must be an integer from 0 to 3600 seconds.');
  if (c.jumpHost && !c.jumpHost.split(',').every(value => /^(?:[\w.-]+@)?(?:\[[0-9a-fA-F:]+\]|[\w.][\w.-]*)(?::[0-9]{1,5})?$/.test(value) && Number(value.match(/:(\d+)$/)?.[1] ?? 22) > 0 && Number(value.match(/:(\d+)$/)?.[1] ?? 22) <= 65535)) return t('Use user@host:port for jump hosts, separated by commas.');
  if (/[\r\n\0]/.test(c.identityFile ?? '')) return t('The private key path cannot contain control characters.');
  if ([c.notes, c.aiNotes].some(value => new TextEncoder().encode(value ?? '').length > 16384)) return t('Host notes must not exceed 16,384 bytes.');
  const variables = Object.entries(c.environment ?? {});
  if (variables.length > 64 || variables.reduce((total, [name, value]) => total + new TextEncoder().encode(name + value).length, 0) > 32768
    || variables.some(([name, value]) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || name.length > 128 || new TextEncoder().encode(value).length > 8192 || /[\r\n\0]/.test(value))) return t('Invalid environment variable name, value or size.');
  for (const [specs, pattern, label] of [
    [c.localForwards, STATIC_FORWARD, 'Local forward'],
    [c.remoteForwards, STATIC_FORWARD, 'Remote forward'],
    [c.dynamicForwards, DYNAMIC_FORWARD, 'Dynamic forward'],
  ] as const) {
    for (const spec of specs ?? []) {
      const match = spec.match(pattern);
      const ports = match?.slice(1) ?? [];
      if (!match || !ports.every(part => Number(part) >= 1 && Number(part) <= 65535)) {
        return t('Invalid {{kind}} specification (example: {{example}})', { kind: t(label), example: pattern === DYNAMIC_FORWARD ? '1080' : '8080:localhost:80' });
      }
    }
  }
  if (
    c.port !== undefined &&
    c.port !== null &&
    (!Number.isInteger(c.port) || c.port < 1 || c.port > 65535)
  ) {
    return t('Port must be an integer from 1 to 65535.');
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

/** Tests a connection (explicit parameters, so the form can test before saving). */
export function sshTest(target: {
  host: string;
  port?: number;
  user: string;
  password?: string;
} & SshOptions): Promise<string> {
  return invoke('ssh_test', {
    host: target.host,
    port: target.port ?? null,
    user: target.user ?? '',
    password: target.password ?? '',
    options: { identityFile: target.identityFile, jumpHost: target.jumpHost,
      serverAliveInterval: target.serverAliveInterval, shellIntegration: target.shellIntegration,
      localForwards: target.localForwards, remoteForwards: target.remoteForwards,
      dynamicForwards: target.dynamicForwards, proxyId: target.proxyId, environment: target.environment, authenticationMode: target.authenticationMode },
  });
}

/** Host aliases declared in the user's SSH config file; only non-secret fields come back. */
export function sshConfigCandidates(): Promise<SshConfigCandidate[]> {
  return invoke('ssh_config_candidates');
}

/** Queries the host fingerprint and whether it is already trusted (used for first-connection confirmation). */
export interface SshHostKeyInfo {
  fingerprint: string;
  known: boolean;
  keyType: string;
}

export function connectionTarget(conn: SshConnection) {
  return { name: conn.name, host: conn.host, user: conn.user, port: conn.port, connectionId: conn.id,
    identityFile: conn.identityFile, jumpHost: conn.jumpHost, serverAliveInterval: conn.serverAliveInterval,
    shellIntegration: conn.shellIntegration, localForwards: conn.localForwards,
    remoteForwards: conn.remoteForwards, dynamicForwards: conn.dynamicForwards,
    autoReconnect: conn.autoReconnect, proxyId: conn.proxyId, environment: conn.environment, notes: conn.notes, aiNotes: conn.aiNotes, authenticationMode: conn.authMethod };
}

export function sshHostKeyInfo(host: string, port?: number, options?: SshOptions): Promise<SshHostKeyInfo> {
  return invoke('ssh_host_key_info', { host, port: port ?? null, ...(options ? { options } : {}) });
}

/** Records the host key as trusted after the user confirms the fingerprint (idempotent). */
export function sshTrustHostKey(host: string, port: number | undefined, expectedFingerprint: string, options?: SshOptions): Promise<void> {
  return invoke('ssh_trust_host_key', { host, port: port ?? null, expectedFingerprint, ...(options ? { options } : {}) });
}

/** Lists a remote directory by connection id; the backend resolves the password. Returns entries + the real path of the actual directory. */
export function sshFsList(id: string, path?: string): Promise<SshListResponse> {
  return invoke('ssh_list', { id, path: path ?? null });
}

/** Read metadata for one remote path (path bar file detection and the properties dialog). */
export function sshStat(id: string, path: string): Promise<FileStat> {
  return invoke('ssh_stat', { id, path });
}

export interface SshSystemStatus {
  system: string;
  hostname: string;
  latencyMs: number;
  uptimeSeconds: number | null;
  load: string;
  cpuTotal: number | null;
  cpuIdle: number | null;
  memoryTotal: number | null;
  memoryAvailable: number | null;
  diskTotal: number | null;
  diskUsed: number | null;
  networkReceived?: number | null;
  networkTransmitted?: number | null;
}

export interface NetworkProbe {
  dnsMs: number;
  attempts: { latencyMs: number | null; errorKind: 'timeout' | 'refused' | 'unreachable' | null }[];
}

/** Connect directly to the target port from this machine without SSH authentication. */
export function sshNetworkProbe(host: string, port: number): Promise<NetworkProbe> {
  return invoke('ssh_network_probe', { host, port });
}

export interface SshStatusMetrics {
  status: boolean;
  cpu: boolean;
  memory: boolean;
  disk: boolean;
  network: boolean;
  load: boolean;
  uptime: boolean;
}

/** Omitted selections retain full collection for existing terminal status panels. */
export async function sshSystemStatus(id: string, host: string, port: number, user?: string, metrics?: SshStatusMetrics): Promise<SshSystemStatus> {
  const status = await invoke<SshSystemStatus>('ssh_system_status', { id, host, port, user: user ?? null, ...(metrics ? { metrics } : {}) });
  if (status?.system) useHostSystems.getState().remember(id, status.system);
  return status;
}

/** Submit secrets through redacted fields; neither profiles nor diagnostics retain them. */
export function sshAuthenticateSession(target: SshAuthenticationTarget, method: 'password' | 'keyPassphrase', secret: string): Promise<void> {
  return invoke('ssh_authenticate_session', { id: target.connectionId, host: target.host, port: target.port ?? 22,
    user: target.user ?? '', method, password: method === 'password' ? secret : '', passphrase: method === 'keyPassphrase' ? secret : '' });
}

export function sshForgetSessionAuth(id: string): Promise<void> {
  return invoke('ssh_forget_session_auth', { id });
}

/** Search through one file channel and cancel obsolete requests. */
export async function sshSearchFiles(id: string, path: string, query: string, signal: AbortSignal,
  onProgress?: (result: { entries: FsEntry[]; truncated: boolean; skipped: number }) => void):
  Promise<{ entries: FsEntry[]; truncated: boolean; skipped: number }> {
  const requestId = crypto.randomUUID();
  const cancel = () => { void invoke('ssh_search_cancel', { requestId }).catch(() => {}); };
  if (signal.aborted) return { entries: [], truncated: false, skipped: 0 };
  const progress = new Channel<{ entries: FsEntry[]; truncated: boolean; skipped: number }>();
  progress.onmessage = result => { if (!signal.aborted) onProgress?.(result); };
  signal.addEventListener('abort', cancel, { once: true });
  try { return await invoke('ssh_search', { id, path, text: query, requestId, onProgress: progress }); }
  finally { signal.removeEventListener('abort', cancel); progress.onmessage = () => {}; }
}

/** Downloads a remote file to a local temporary directory and returns the local path (for opening with the system default app). */
export function sshDownload(id: string, path: string): Promise<string> {
  return invoke('ssh_download', { id, path });
}

/** Renames a remote entry (adds a numeric suffix on collision) and returns the final path. */
export function sshRename(id: string, path: string, newName: string): Promise<string> {
  return invoke<string>('ssh_rename', { id, path, newName });
}

/** Creates an empty remote file (adds a numeric suffix on collision) and returns the final path. */
export function sshCreateFile(id: string, dir: string, name: string): Promise<string> {
  return invoke<string>('ssh_create_file', { id, dir, name });
}

/** Creates a remote folder (adds a numeric suffix on collision) and returns the final path. */
export function sshCreateDir(id: string, dir: string, name: string): Promise<string> {
  return invoke<string>('ssh_create_dir', { id, dir, name });
}

/** Moves a remote file/directory into a destination directory (SFTP rename, adds a numeric suffix on collision) and returns the final path. */
export function sshMove(id: string, path: string, destDir: string): Promise<string> {
  return invoke<string>('ssh_move', { id, path, destDir });
}

/** A completed from→to pair (used to undo remote file operations). */
export interface SshOpPair {
  from: string;
  to: string;
}

/** Batch remote operation result: completed items + failure messages (one failure does not stop the rest). */
export interface SshOpOutcome {
  completed: SshOpPair[];
  errors: string[];
}

/** Copies remote files/directories into a destination directory (remote cp -R; pre-checks name collisions and self-subtrees per item). */
export function sshCopy(id: string, paths: string[], destDir: string): Promise<SshOpOutcome> {
  return invoke('ssh_copy', { id, paths, destDir });
}

/** Undoable delete: moves remote entries into a remote staging directory and returns the original→staging mapping. */
export function sshStageDelete(id: string, paths: string[], undoEnabled = true): Promise<SshOpOutcome> {
  return invoke('ssh_stage_delete', { id, paths, ...(undoEnabled ? {} : { undoEnabled: false }) });
}

/** Undoes a delete: moves staged items back to their original locations. */
export function sshRestoreStaged(id: string, items: SshOpPair[]): Promise<SshOpOutcome> {
  return invoke('ssh_restore_staged', { id, items });
}

/** Permanently deletes staged items (after the undo window ends). */
export function sshPurgeStaged(id: string, paths: string[]): Promise<void> {
  return invoke('ssh_purge_staged', { id, paths });
}

/** Upload a local path into a remote directory; resolves with the final remote path. */
export function sshUpload(id: string, remoteDir: string, localPath: string): Promise<string> {
  return invoke('ssh_upload', { id, remoteDir, localPath });
}

let seq = 0;
/** Generates a connection id (created in the frontend; the backend upserts by id). */
export function newSshId(): string {
  seq += 1;
  return `ssh-${Date.now().toString(36)}-${seq}`;
}
