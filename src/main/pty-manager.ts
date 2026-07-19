import * as pty from 'node-pty';
import { EventEmitter } from 'events';
import { ISessionBackend } from '../shared/backend-interface';
import { SessionInfo, SessionOptions, SSHConnectOptions } from '../shared/types';

interface ManagedSession {
  info: SessionInfo;
  process: pty.IPty;
  buffer: Buffer[];  // ring buffer for inactive sessions
}

export class PtyManager extends EventEmitter implements ISessionBackend {
  private sessions = new Map<string, ManagedSession>();
  private sessionCounter = 0;

  async createSession(opts: SessionOptions = {}): Promise<SessionInfo> {
    const id = `local-${++this.sessionCounter}-${Date.now()}`;
    const shell = opts.shell || process.env.SHELL || '/bin/zsh';
    const cols = opts.cols || 80;
    const rows = opts.rows || 24;

    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: opts.cwd || process.env.HOME || '/',
      env: process.env as { [key: string]: string },
    });

    const session: SessionInfo = {
      id,
      type: 'local',
      title: shell.split('/').pop() || 'shell',
      cwd: opts.cwd || process.env.HOME,
      shell,
      cols,
      rows,
      createdAt: Date.now(),
    };

    const managed: ManagedSession = {
      info: session,
      process: ptyProcess,
      buffer: [],
    };

    // Forward PTY output
    ptyProcess.onData((data: string) => {
      this.emit('output', id, Buffer.from(data, 'utf-8'));
    });

    // Detect title changes (OSC 0 and OSC 2)
    ptyProcess.onData((data: string) => {
      const titleMatch = data.match(/\x1b\][02];([^\x07\x1b]+)/);
      if (titleMatch) {
        managed.info.title = titleMatch[1];
        this.emit('title-change', id, titleMatch[1]);
      }
    });

    ptyProcess.onExit(({ exitCode }) => {
      this.emit('exit', id, exitCode);
      this.sessions.delete(id);
    });

    this.sessions.set(id, managed);
    return session;
  }

  async closeSession(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) return;
    session.process.kill();
    this.sessions.delete(id);
  }

  writeToSession(id: string, data: Uint8Array): void {
    const session = this.sessions.get(id);
    if (!session) return;
    session.process.write(data.toString());
  }

  resizeSession(id: string, cols: number, rows: number): void {
    const session = this.sessions.get(id);
    if (!session) return;
    session.process.resize(cols, rows);
    session.info.cols = cols;
    session.info.rows = rows;
  }

  async listSessions(): Promise<SessionInfo[]> {
    return Array.from(this.sessions.values()).map(s => ({ ...s.info }));
  }

  async connectSSH(_opts: SSHConnectOptions): Promise<SessionInfo> {
    // Will be implemented in Phase 4
    throw new Error('SSH not yet implemented');
  }

  onOutput(callback: (sessionId: string, data: Uint8Array) => void): void {
    this.on('output', callback);
  }

  onExit(callback: (sessionId: string, exitCode: number) => void): void {
    this.on('exit', callback);
  }

  onTitleChange(callback: (sessionId: string, title: string) => void): void {
    this.on('title-change', callback);
  }

  destroy(): void {
    for (const [, session] of this.sessions) {
      session.process.kill();
    }
    this.sessions.clear();
    this.removeAllListeners();
  }
}
