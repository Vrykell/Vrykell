import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC_PTY_CREATE, IPC_PTY_WRITE, IPC_PTY_RESIZE, IPC_PTY_CLOSE,
  IPC_SSH_CONNECT, IPC_AI_CHAT, IPC_AI_ABORT,
  IPC_SETTINGS_SAVE, IPC_SETTINGS_LOAD,
  IPC_PTY_OUTPUT, IPC_PTY_EXIT, IPC_PTY_TITLE_CHANGE,
  IPC_SESSION_CREATED, IPC_SESSION_CLOSED,
  IPC_SSH_STATUS, IPC_AI_RESPONSE, IPC_APP_MENU_ACTION,
} from '../shared/ipc-channels';
import { SessionOptions, SSHConnectOptions, Message } from '../shared/types';

/**
 * Safe API exposed to the renderer process via contextBridge.
 * No direct access to Node.js or Electron internals.
 */
const electronAPI = {
  // ── PTY ──────────────────────────────────────────────
  createPTY: (opts: SessionOptions) => ipcRenderer.invoke(IPC_PTY_CREATE, opts),
  writeToPTY: (sessionId: string, data: string) => {
    ipcRenderer.send(IPC_PTY_WRITE, sessionId, data);
  },
  resizePTY: (sessionId: string, cols: number, rows: number) => {
    ipcRenderer.send(IPC_PTY_RESIZE, sessionId, cols, rows);
  },
  closePTY: (sessionId: string) => ipcRenderer.invoke(IPC_PTY_CLOSE, sessionId),

  // ── SSH ──────────────────────────────────────────────
  connectSSH: (opts: SSHConnectOptions) => ipcRenderer.invoke(IPC_SSH_CONNECT, opts),

  // ── AI ───────────────────────────────────────────────
  sendAIChat: (messages: Message[]) => ipcRenderer.invoke(IPC_AI_CHAT, messages),
  abortAI: () => { ipcRenderer.send(IPC_AI_ABORT); },

  // ── Settings ─────────────────────────────────────────
  loadSettings: () => ipcRenderer.invoke(IPC_SETTINGS_LOAD),
  saveSettings: (settings: unknown) => ipcRenderer.invoke(IPC_SETTINGS_SAVE, settings),

  // ── Event listeners (each returns a cleanup function) ─
  onPTYOutput: (cb: (data: { sessionId: string; data: string }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any): void => { cb(data); };
    ipcRenderer.on(IPC_PTY_OUTPUT, handler);
    return () => { ipcRenderer.removeListener(IPC_PTY_OUTPUT, handler); };
  },
  onPTYExit: (cb: (data: { sessionId: string; exitCode: number }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any): void => { cb(data); };
    ipcRenderer.on(IPC_PTY_EXIT, handler);
    return () => { ipcRenderer.removeListener(IPC_PTY_EXIT, handler); };
  },
  onPTYTitleChange: (cb: (data: { sessionId: string; title: string }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any): void => { cb(data); };
    ipcRenderer.on(IPC_PTY_TITLE_CHANGE, handler);
    return () => { ipcRenderer.removeListener(IPC_PTY_TITLE_CHANGE, handler); };
  },
  onSessionCreated: (cb: (session: any) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, session: any): void => { cb(session); };
    ipcRenderer.on(IPC_SESSION_CREATED, handler);
    return () => { ipcRenderer.removeListener(IPC_SESSION_CREATED, handler); };
  },
  onSessionClosed: (cb: (data: { sessionId: string }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any): void => { cb(data); };
    ipcRenderer.on(IPC_SESSION_CLOSED, handler);
    return () => { ipcRenderer.removeListener(IPC_SESSION_CLOSED, handler); };
  },
  onSSHStatus: (cb: (data: any) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any): void => { cb(data); };
    ipcRenderer.on(IPC_SSH_STATUS, handler);
    return () => { ipcRenderer.removeListener(IPC_SSH_STATUS, handler); };
  },
  onAIResponse: (cb: (data: any) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any): void => { cb(data); };
    ipcRenderer.on(IPC_AI_RESPONSE, handler);
    return () => { ipcRenderer.removeListener(IPC_AI_RESPONSE, handler); };
  },
  onMenuAction: (cb: (data: { action: string }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any): void => { cb(data); };
    ipcRenderer.on(IPC_APP_MENU_ACTION, handler);
    return () => { ipcRenderer.removeListener(IPC_APP_MENU_ACTION, handler); };
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

export type ElectronAPI = typeof electronAPI;
