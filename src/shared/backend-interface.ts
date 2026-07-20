import { SessionInfo, SessionOptions, SSHConnectOptions } from './types';

/**
 * Abstract interface for the session backend.
 * Electron implements this with node-pty + MessagePort.
 * Can be swapped for Tauri (portable-pty + Tauri IPC) without touching the UI.
 */
export interface ISessionBackend {
  /** Create a new local PTY session */
  createSession(opts: SessionOptions): Promise<SessionInfo>;

  /** Close a session */
  closeSession(id: string): Promise<void>;

  /** Write data to a session's stdin */
  writeToSession(id: string, data: string): void;

  /** Resize a session's PTY */
  resizeSession(id: string, cols: number, rows: number): void;

  /** List all active sessions */
  listSessions(): Promise<SessionInfo[]>;

  /** Connect to a remote SSH host */
  connectSSH(opts: SSHConnectOptions): Promise<SessionInfo>;

  /** Register callback for session output */
  onOutput(callback: (sessionId: string, data: string) => void): void;

  /** Register callback for session exit */
  onExit(callback: (sessionId: string, exitCode: number) => void): void;

  /** Register callback for title changes */
  onTitleChange(callback: (sessionId: string, title: string) => void): void;

  /** Clean up all resources */
  destroy(): void;
}
