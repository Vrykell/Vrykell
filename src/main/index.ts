import { app, BrowserWindow, Menu, MenuItemConstructorOptions } from 'electron';
import * as path from 'path';
import { PtyManager } from './pty-manager';
import { SessionStore } from './session-store';
import { AIBridge } from './ai-bridge';
import { SSHClient } from './ssh-client';
import { registerIpcHandlers } from './ipc-handlers';
import { IPC_APP_MENU_ACTION } from '../shared/ipc-channels';

const isDev = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;
const ptyManager = new PtyManager();
const sessionStore = new SessionStore();
const aiBridge = new AIBridge();
const sshClient = new SSHClient();

function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 600,
    minHeight: 400,
    title: 'AI Terminal',
    backgroundColor: '#1e1e1e',
    titleBarStyle: 'hiddenInset', // macOS native style
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // required for node-pty IPC
    },
  });

  // Build menu
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: () => sendMenuAction('new-tab') },
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: () => sendMenuAction('close-tab') },
        { type: 'separator' },
        { label: 'New Window', accelerator: 'CmdOrCtrl+Shift+N', click: () => createWindow() },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Terminal',
      submenu: [
        { label: 'New Local Session', click: () => sendMenuAction('new-local-session') },
        { label: 'New SSH Session...', click: () => sendMenuAction('new-ssh-session') },
        { type: 'separator' },
        { label: 'Toggle AI Panel', accelerator: 'CmdOrCtrl+J', click: () => sendMenuAction('toggle-ai-panel') },
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'About AI Terminal', click: () => sendMenuAction('show-about') },
      ],
    },
  ];

  if (process.platform === 'darwin') {
    template.unshift({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    });
  }

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);

  // Load renderer
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', '..', 'renderer', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function sendMenuAction(action: string): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC_APP_MENU_ACTION, { action });
  }
}

// Register IPC handlers
registerIpcHandlers(ptyManager, sessionStore, aiBridge, sshClient, getMainWindow);

// App lifecycle
app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  // On macOS, keep the app alive (dock icon) and preserve IPC listeners
  // so that pty:output forwarding still works when windows are recreated.
  // ptyManager.destroy() is called in 'before-quit' for full cleanup.
  if (process.platform !== 'darwin') {
    ptyManager.destroy();
    app.quit();
  } else {
    // Kill existing PTY sessions but keep IPC listeners intact
    // so that new windows can create fresh sessions.
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', () => {
  ptyManager.destroy();
});
