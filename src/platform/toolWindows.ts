import { emitTo, listen, type UnlistenFn } from '@tauri-apps/api/event';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { t } from '@i18n';

export interface ToolWindowInput<T = unknown> { kind: string; input: T }
interface Request { id: string; action: unknown; ready?: boolean }
interface Reply { id: string; ok: boolean; value?: unknown; error?: string }
interface Session {
  label: string; token: string; input: ToolWindowInput; action?: (value: unknown) => Promise<unknown>;
  stop: UnlistenFn; window?: WebviewWindow;
}
const sessions = new Map<string, Session>();
const opening = new Map<string, Promise<void>>();

/** Each tool keeps its own webview and state when minimized or restored. */
export function openToolWindow<T, A>(key: string, title: string, input: ToolWindowInput<T>, action: (value: A) => Promise<unknown>): Promise<void> {
  const existing = sessions.get(key);
  if (existing) existing.action = value => action(value as A);
  const pending = opening.get(key);
  if (pending) return pending;
  const operation = (async () => {
    if (existing?.window) {
      await existing.window.unminimize(); await existing.window.show(); await existing.window.setFocus(); return;
    }
    const token = crypto.randomUUID(); const label = `tool-${token}`;
    const session: Session = { label, token, input, stop: () => {}, action: value => action(value as A) };
    session.stop = await listen<Request>(`tool-request:${token}`, async ({ payload }) => {
      let reply: Reply;
      try {
        if (!payload.ready && !session.action) throw new Error(t('The source panel changed. Reopen this tool from its panel.'));
        const value = payload.ready ? session.input : await session.action!(payload.action);
        reply = { id: payload.id, ok: true, value };
      } catch (error) { reply = { id: payload.id, ok: false, error: String(error) }; }
      await emitTo(session.label, `tool-reply:${token}`, reply).catch(() => {});
    });
    sessions.set(key, session);
    try {
      const child = new WebviewWindow(label, { title, url: `/?toolWindow=${token}`, width: 368, height: 488,
        minWidth: 340, minHeight: 280, decorations: false, resizable: true, visible: true, focus: true,
        alwaysOnTop: false, skipTaskbar: false,
        backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() || undefined });
      session.window = child;
      const cleanup = () => { session.stop(); if (sessions.get(key) === session) sessions.delete(key); };
      const created = new Promise<void>((resolve, reject) => {
        void child.once('tauri://created', () => resolve());
        void child.once('tauri://error', event => { cleanup(); reject(new Error(String(event.payload))); });
      });
      await child.once('tauri://destroyed', cleanup);
      await created;
    } catch (error) { session.stop(); sessions.delete(key); throw error; }
  })();
  opening.set(key, operation);
  void operation.finally(() => { if (opening.get(key) === operation) opening.delete(key); }).catch(() => {});
  return operation;
}

export function detachToolWindow(key: string): void { const session = sessions.get(key); if (session) session.action = undefined; }

/** Replies are correlated and bounded so a closed owner cannot leave actions pending forever. */
export async function createToolWindowClient(token: string) {
  const pending = new Map<string, { resolve: (value: unknown) => void; reject: (reason: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  const stop = await listen<Reply>(`tool-reply:${token}`, ({ payload }) => {
    const request = pending.get(payload.id); if (!request) return;
    clearTimeout(request.timer); pending.delete(payload.id);
    if (payload.ok) request.resolve(payload.value); else request.reject(new Error(payload.error));
  });
  const send = (action: unknown, ready = false) => new Promise<unknown>((resolve, reject) => {
    const id = crypto.randomUUID();
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(t('The main window did not respond. Reopen this tool.'))); }, 30000);
    pending.set(id, { resolve, reject, timer });
    void emitTo('main', `tool-request:${token}`, { id, action, ready } satisfies Request).catch(error => {
      clearTimeout(timer); pending.delete(id); reject(error);
    });
  });
  return { ready: () => send(null, true) as Promise<ToolWindowInput>, send,
    dispose: () => { stop(); for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error(t('Close'))); } pending.clear(); } };
}
