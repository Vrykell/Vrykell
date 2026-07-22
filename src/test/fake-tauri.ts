import type { SessionInfo, SessionOptions } from '../shared/types';

export type EventMap = {
  'pty:output': { sessionId: string; data: string };
  'pty:exit': { sessionId: string; exitCode: number };
  'pty:title-change': { sessionId: string; title: string };
  'session:created': { session: SessionInfo };
  'session:closed': { sessionId: string };
  'ai:response': { chunk?: string; done?: boolean; error?: string };
  'app:menu-action': { action: string };
};

export type InvokeHandler = (
  cmd: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

export class FakeTauriBackend {
  sessions: SessionInfo[] = [];
  listeners: Partial<
    Record<keyof EventMap, Array<(payload: any) => void>>
  > = {};
  nextId = 1;
  customInvoke?: InvokeHandler;

  /** Install as the active mock. Call before importing modules that use @tauri-apps/api. */
  install() {
    (globalThis as any).__FAKE_TAURI_BACKEND__ = this;
  }

  createSession(opts: SessionOptions): SessionInfo {
    const id = `test-${this.nextId++}`;
    const session: SessionInfo = {
      id,
      type: 'local',
      title: opts.shell?.split('/').pop() || 'bash',
      cwd: opts.cwd,
      shell: opts.shell,
      cols: opts.cols || 80,
      rows: opts.rows || 24,
      createdAt: Date.now(),
    };
    this.sessions.push(session);
    // Matches real Rust backend: create_pty does NOT emit session:created;
    // the renderer adds the session from the invoke() return value.
    return session;
  }

  write(id: string, data: string): void {
    // Echo back for simple integration tests
    this.emit('pty:output', { sessionId: id, data });
  }

  close(id: string): void {
    this.sessions = this.sessions.filter((s) => s.id !== id);
    // Matches real Rust backend: closing kills the child, the reader thread
    // then emits pty:exit on EOF.
    this.emit('pty:exit', { sessionId: id, exitCode: 0 });
  }

  emit<T extends keyof EventMap>(event: T, payload: EventMap[T]) {
    this.listeners[event]?.forEach((cb) => cb(payload));
  }

  invoke = async (cmd: string, args?: Record<string, unknown>) => {
    if (this.customInvoke) {
      return this.customInvoke(cmd, args);
    }
    switch (cmd) {
      case 'create_pty':
        return this.createSession(args as SessionOptions);
      case 'write_pty':
        this.write(args!.sessionId as string, args!.data as string);
        return;
      case 'resize_pty':
        return;
      case 'close_pty':
        this.close(args!.sessionId as string);
        return;
      case 'list_pty':
        return this.sessions;
      default:
        throw new Error(`Unknown command: ${cmd}`);
    }
  };

  listen = async <T extends keyof EventMap>(
    event: T,
    cb: (payload: EventMap[T]) => void,
  ): Promise<() => void> => {
    (this.listeners[event] ??= []).push(cb);
    return () => {
      this.listeners[event] = this.listeners[event]!.filter((f) => f !== cb);
    };
  };
}
