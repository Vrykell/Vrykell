export type SessionType = 'local' | 'ssh';

export interface SessionInfo {
  id: string;
  type: SessionType;
  title: string;
  cwd?: string;
  shell?: string;
  cols: number;
  rows: number;
  createdAt: number;
  /** SSH-specific fields */
  host?: string;
  username?: string;
}

export interface SessionOptions {
  shell?: string;
  cwd?: string;
  cols?: number;
  rows?: number;
}

export interface SSHConnectOptions {
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  tryAgent?: boolean;
}

export interface SavedSSHConnection {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  privateKeyPath?: string;
}
