/**
 * Backend → Renderer event listeners
 */
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { SessionInfo } from '@shared/types';
import type { TerminalEvent } from '@shared/terminal/events';

export function onPTYOutput(
  cb: (data: { sessionId: string; events: TerminalEvent[]; cols?: number; rows?: number }) => void,
): Promise<UnlistenFn> {
  return listen<{ sessionId: string; events: TerminalEvent[]; cols?: number; rows?: number }>('pty:output', (event) => {
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

export function onAIResponse(
  cb: (data: { chunk?: string; done?: boolean; error?: string }) => void,
): Promise<UnlistenFn> {
  return listen<{ chunk?: string; done?: boolean; error?: string }>('ai:response', (event) => {
    cb(event.payload);
  });
}

export function onMenuAction(
  cb: (data: { action: string }) => void,
): Promise<UnlistenFn> {
  return listen<{ action: string }>('app:menu-action', (event) => {
    cb(event.payload);
  });
}
