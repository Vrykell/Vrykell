import { t } from '@i18n';
import { invoke } from '@platform/diagnostics';
import type { FsEntry, FileStat } from '@platform/api/types';
import type { SshAuthenticationTarget, SshOptions } from '@core/ssh';

/**
 * SSH 连接 API —— 存储与 CRUD 均在后端（SQLite），前端只调用命令。
 * 密码不回显：列表返回 hasPassword 标记，编辑时不回填明文。
 */

export type SshAuthMethod = 'password' | 'key';

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

/** 目录列表响应：条目 + 实际目录的真实路径（空请求 = 远程 home）。 */
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

/** 表单校验：返回错误信息，合法返回 null。 */
export function validateSshConnection(c: Partial<SshConnection>): string | null {
  if (!c.name || !c.name.trim()) return '请输入连接名';
  if (!c.host || !c.host.trim()) return '请输入主机 IP 或域名';
  if (c.host.startsWith('-') || /\s/.test(c.host)) return '主机名不能包含空白或以 - 开头';
  if (c.user?.startsWith('-') || /\s/.test(c.user ?? '')) return '账户名不能包含空白或以 - 开头';
  if (c.serverAliveInterval !== undefined && (!Number.isInteger(c.serverAliveInterval) || c.serverAliveInterval < 0 || c.serverAliveInterval > 3600)) return '保活间隔需为 0-3600 秒的整数';
  if (c.jumpHost && !c.jumpHost.split(',').every(value => /^(?:[\w.-]+@)?(?:\[[0-9a-fA-F:]+\]|[\w.][\w.-]*)(?::[0-9]{1,5})?$/.test(value) && Number(value.match(/:(\d+)$/)?.[1] ?? 22) > 0 && Number(value.match(/:(\d+)$/)?.[1] ?? 22) <= 65535)) return '跳板机格式为 用户@主机:端口，多个跳板机用逗号分隔';
  if (/[\r\n\0]/.test(c.identityFile ?? '')) return '私钥路径不能包含控制字符';
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
} & SshOptions): Promise<string> {
  return invoke('ssh_test', {
    host: target.host,
    port: target.port ?? null,
    user: target.user ?? '',
    password: target.password ?? '',
    options: { identityFile: target.identityFile, jumpHost: target.jumpHost,
      serverAliveInterval: target.serverAliveInterval, shellIntegration: target.shellIntegration,
      localForwards: target.localForwards, remoteForwards: target.remoteForwards,
      dynamicForwards: target.dynamicForwards },
  });
}

/** Host aliases declared in the user's SSH config file; only non-secret fields come back. */
export function sshConfigCandidates(): Promise<SshConfigCandidate[]> {
  return invoke('ssh_config_candidates');
}

/** 查询主机指纹与 known_hosts 记录状态（首次连接确认用）。 */
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
    autoReconnect: conn.autoReconnect };
}

export function sshHostKeyInfo(host: string, port?: number): Promise<SshHostKeyInfo> {
  return invoke('ssh_host_key_info', { host, port: port ?? null });
}

/** 用户确认指纹后记录主机密钥到 known_hosts（幂等）。 */
export function sshTrustHostKey(host: string, port: number | undefined, expectedFingerprint: string): Promise<void> {
  return invoke('ssh_trust_host_key', { host, port: port ?? null, expectedFingerprint });
}

/** 列出远程目录（按连接 id，密码由后端解析）。返回条目 + 实际目录真实路径。 */
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

/** Collect metadata through a separate authenticated connection. */
export function sshSystemStatus(id: string, host: string, port: number, user?: string): Promise<SshSystemStatus> {
  return invoke('ssh_system_status', { id, host, port, user: user ?? null });
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
export async function sshSearchFiles(id: string, path: string, query: string, signal: AbortSignal):
  Promise<{ entries: FsEntry[]; truncated: boolean; skipped: number }> {
  const requestId = crypto.randomUUID();
  const cancel = () => { void invoke('ssh_search_cancel', { requestId }).catch(() => {}); };
  if (signal.aborted) return { entries: [], truncated: false, skipped: 0 };
  signal.addEventListener('abort', cancel, { once: true });
  try { return await invoke('ssh_search', { id, path, text: query, requestId }); }
  finally { signal.removeEventListener('abort', cancel); }
}

/** 下载远程文件到本地临时目录，返回本地路径（用于系统默认应用打开）。 */
export function sshDownload(id: string, path: string): Promise<string> {
  return invoke('ssh_download', { id, path });
}

/** 重命名远程条目（目标重名时自动加序号），返回最终路径。 */
export function sshRename(id: string, path: string, newName: string): Promise<string> {
  return invoke<string>('ssh_rename', { id, path, newName });
}

/** 新建远程空文件（同名自动加序号），返回最终路径。 */
export function sshCreateFile(id: string, dir: string, name: string): Promise<string> {
  return invoke<string>('ssh_create_file', { id, dir, name });
}

/** 新建远程文件夹（同名自动加序号），返回最终路径。 */
export function sshCreateDir(id: string, dir: string, name: string): Promise<string> {
  return invoke<string>('ssh_create_dir', { id, dir, name });
}

/** 移动远程文件/目录到目标目录（SFTP rename，重名自动加序号），返回最终路径。 */
export function sshMove(id: string, path: string, destDir: string): Promise<string> {
  return invoke<string>('ssh_move', { id, path, destDir });
}

/** 完成的一条 from→to 对（用于远程文件操作回退）。 */
export interface SshOpPair {
  from: string;
  to: string;
}

/** 批量远程操作结果：完成项 + 失败说明（部分失败不中断其余项）。 */
export interface SshOpOutcome {
  completed: SshOpPair[];
  errors: string[];
}

/** 复制远程文件/目录到目标目录（远端 cp -R，逐项预检同名/自身子树）。 */
export function sshCopy(id: string, paths: string[], destDir: string): Promise<SshOpOutcome> {
  return invoke('ssh_copy', { id, paths, destDir });
}

/** 可回退删除：把远程条目移动到远端暂存目录，返回 原始→暂存 映射。 */
export function sshStageDelete(id: string, paths: string[], undoEnabled = true): Promise<SshOpOutcome> {
  return invoke('ssh_stage_delete', { id, paths, ...(undoEnabled ? {} : { undoEnabled: false }) });
}

/** 回退删除：把暂存项移回原位。 */
export function sshRestoreStaged(id: string, items: SshOpPair[]): Promise<SshOpOutcome> {
  return invoke('ssh_restore_staged', { id, items });
}

/** 把暂存项永久删除（回退窗口结束后）。 */
export function sshPurgeStaged(id: string, paths: string[]): Promise<void> {
  return invoke('ssh_purge_staged', { id, paths });
}

/** Upload a local path into a remote directory; resolves with the final remote path. */
export function sshUpload(id: string, remoteDir: string, localPath: string): Promise<string> {
  return invoke('ssh_upload', { id, remoteDir, localPath });
}

let seq = 0;
/** 生成连接 id（新建时前端生成，后端按 id upsert）。 */
export function newSshId(): string {
  seq += 1;
  return `ssh-${Date.now().toString(36)}-${seq}`;
}
