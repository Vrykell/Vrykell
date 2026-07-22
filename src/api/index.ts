/**
 * Tauri API Bridge
 *
 * Uses @tauri-apps/api invoke for request-response (Rust commands)
 * and listen() for server-push events (PTY output streaming).
 *
 * Interface mirrors the old ElectronAPI for minimal downstream changes.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { SessionInfo, SessionOptions } from '../shared/types';
import type { TerminalEvent } from '../shared/terminal-events';

// ── PTY Commands (Renderer → Backend) ──────────────────────────

export function createPTY(opts: SessionOptions): Promise<SessionInfo> {
  return invoke('create_pty', {
    shell: opts.shell || null,
    cwd: opts.cwd || null,
    cols: opts.cols || null,
    rows: opts.rows || null,
  });
}

export function writeToPTY(sessionId: string, data: string): Promise<void> {
  return invoke('write_pty', { sessionId, data });
}

export function resizePTY(sessionId: string, cols: number, rows: number): Promise<void> {
  return invoke('resize_pty', { sessionId, cols, rows });
}

export function closePTY(sessionId: string): Promise<void> {
  return invoke('close_pty', { sessionId });
}

// ── Event Listeners (Backend → Renderer) ───────────────────────
// Each returns Promise<UnlistenFn> for cleanup in useEffect return

export function onPTYOutput(
  cb: (data: { sessionId: string; events: TerminalEvent[] }) => void,
): Promise<UnlistenFn> {
  return listen<{ sessionId: string; events: TerminalEvent[] }>('pty:output', (event) => {
    cb(event.payload);
  });
}

export function onPTYExit(
  cb: (data: { sessionId: string; exitCode: number }) => void,
): Promise<UnlistenFn> {
  return listen<{ sessionId: string; exitCode: number }>('pty:exit', (event) => {
    cb(event.payload);
  });
}

export function onPTYTitleChange(
  cb: (data: { sessionId: string; title: string }) => void,
): Promise<UnlistenFn> {
  return listen<{ sessionId: string; title: string }>('pty:title-change', (event) => {
    cb(event.payload);
  });
}

export function onSessionCreated(
  cb: (session: SessionInfo) => void,
): Promise<UnlistenFn> {
  return listen<{ session: SessionInfo }>('session:created', (event) => {
    cb(event.payload.session);
  });
}

export function onSessionClosed(
  cb: (data: { sessionId: string }) => void,
): Promise<UnlistenFn> {
  return listen<{ sessionId: string }>('session:closed', (event) => {
    cb(event.payload);
  });
}

// ── AI (Phase 3 placeholder) ───────────────────────────────────

export function onAIResponse(
  cb: (data: { chunk?: string; done?: boolean; error?: string }) => void,
): Promise<UnlistenFn> {
  return listen<{ chunk?: string; done?: boolean; error?: string }>(
    'ai:response',
    (event) => {
      cb(event.payload);
    },
  );
}

// ── Menu Actions ────────────────────────────────────────────────

export function onMenuAction(
  cb: (data: { action: string }) => void,
): Promise<UnlistenFn> {
  return listen<{ action: string }>('app:menu-action', (event) => {
    cb(event.payload);
  });
}

// ── Settings (Phase 3+ placeholder) ─────────────────────────────

export function loadSettings(): Promise<unknown> {
  return invoke('load_settings');
}

export function saveSettings(settings: unknown): Promise<void> {
  return invoke('save_settings', { settings });
}

export function exitApp(): Promise<void> {
  return invoke('exit_app');
}
