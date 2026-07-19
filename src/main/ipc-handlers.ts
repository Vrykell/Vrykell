import { ipcMain, BrowserWindow } from 'electron';
import { PtyManager } from './pty-manager';
import { SessionStore } from './session-store';
import { AIBridge } from './ai-bridge';
import { SSHClient } from './ssh-client';
import {
  IPC_PTY_CREATE, IPC_PTY_WRITE, IPC_PTY_RESIZE, IPC_PTY_CLOSE,
  IPC_SSH_CONNECT, IPC_AI_CHAT, IPC_AI_ABORT,
  IPC_SETTINGS_SAVE, IPC_SETTINGS_LOAD,
  IPC_SESSION_CREATED, IPC_SESSION_CLOSED,
  IPC_PTY_OUTPUT, IPC_PTY_EXIT, IPC_PTY_TITLE_CHANGE,
  IPC_SSH_STATUS, IPC_AI_RESPONSE, IPC_APP_MENU_ACTION,
} from '../shared/ipc-channels';
import { SessionOptions, SSHConnectOptions, Message } from '../shared/types';

export function registerIpcHandlers(
  ptyManager: PtyManager,
  sessionStore: SessionStore,
  aiBridge: AIBridge,
  sshClient: SSHClient,
  getMainWindow: () => BrowserWindow | null,
): void {
  const send = (channel: string, ...args: unknown[]) => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, ...args);
    }
  };

  // ── PTY ──────────────────────────────────────────────

  ipcMain.handle(IPC_PTY_CREATE, async (_event, opts: SessionOptions) => {
    const session = await ptyManager.createSession(opts);
    sessionStore.add(session);
    send(IPC_SESSION_CREATED, session);
    return session;
  });

  ipcMain.on(IPC_PTY_WRITE, (_event, sessionId: string, data: Uint8Array) => {
    ptyManager.writeToSession(sessionId, data);
  });

  ipcMain.on(IPC_PTY_RESIZE, (_event, sessionId: string, cols: number, rows: number) => {
    ptyManager.resizeSession(sessionId, cols, rows);
  });

  ipcMain.handle(IPC_PTY_CLOSE, async (_event, sessionId: string) => {
    await ptyManager.closeSession(sessionId);
    sessionStore.remove(sessionId);
    send(IPC_SESSION_CLOSED, { sessionId });
  });

  // ── SSH ──────────────────────────────────────────────

  ipcMain.handle(IPC_SSH_CONNECT, async (_event, opts: SSHConnectOptions) => {
    try {
      send(IPC_SSH_STATUS, { status: 'connecting', host: opts.host });
      const session = await sshClient.connect(opts);
      sessionStore.add(session);
      send(IPC_SESSION_CREATED, session);
      send(IPC_SSH_STATUS, { sessionId: session.id, status: 'connected' });
      return session;
    } catch (err: any) {
      send(IPC_SSH_STATUS, { status: 'error', error: err.message });
      throw err;
    }
  });

  // ── AI ───────────────────────────────────────────────

  ipcMain.handle(IPC_AI_CHAT, async (_event, messages: Message[]) => {
    aiBridge.chat(messages);
  });

  ipcMain.on(IPC_AI_ABORT, () => {
    aiBridge.abort();
  });

  // Forward AI streaming responses to renderer
  aiBridge.on('response-chunk', (chunk: string) => {
    send(IPC_AI_RESPONSE, { chunk });
  });
  aiBridge.on('response-done', () => {
    send(IPC_AI_RESPONSE, { done: true });
  });
  aiBridge.on('error', (err: Error) => {
    send(IPC_AI_RESPONSE, { error: err.message });
  });

  // ── PTY Output Forwarding ───────────────────────────

  ptyManager.onOutput((sessionId: string, data: Uint8Array) => {
    send(IPC_PTY_OUTPUT, { sessionId, data });
  });

  ptyManager.onExit((sessionId: string, exitCode: number) => {
    send(IPC_PTY_EXIT, { sessionId, exitCode });
    sessionStore.remove(sessionId);
  });

  ptyManager.onTitleChange((sessionId: string, title: string) => {
    send(IPC_PTY_TITLE_CHANGE, { sessionId, title });
  });

  // ── Settings ─────────────────────────────────────────

  // Phase 3-5: implement persistent settings
  ipcMain.handle(IPC_SETTINGS_LOAD, async () => {
    return null; // default settings
  });

  ipcMain.handle(IPC_SETTINGS_SAVE, async (_event, _settings: unknown) => {
    // TODO: save to disk
  });
}
