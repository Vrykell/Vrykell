import { useEffect } from 'react';
import {
  onSessionCreated, onSessionClosed, onPTYExit,
  onPTYTitleChange, onAIResponse, onMenuAction,
} from '@api';
import { useTerminalStore } from '@renderer/stores/terminal-store';
import type { UnlistenFn } from '@tauri-apps/api/event';

/**
 * Subscribes to all backend → renderer Tauri events and routes them
 * into the store / session lifecycle. Mounted once at app shell level.
 */
export function useBackendEvents(createAndAddSession: () => Promise<unknown>) {
  const addSession = useTerminalStore((s) => s.addSession);
  const removeSession = useTerminalStore((s) => s.removeSession);
  const updateSessionTitle = useTerminalStore((s) => s.updateSessionTitle);
  const addAIMessage = useTerminalStore((s) => s.addAIMessage);
  const setAIStreaming = useTerminalStore((s) => s.setAIStreaming);

  useEffect(() => {
    const unlisteners: UnlistenFn[] = [];

    onSessionCreated((s) => addSession(s)).then((fn) => unlisteners.push(fn));
    onSessionClosed(({ sessionId }) => removeSession(sessionId)).then((fn) => unlisteners.push(fn));
    onPTYExit(({ sessionId }) => removeSession(sessionId)).then((fn) => unlisteners.push(fn));
    onPTYTitleChange(({ sessionId, title }) => updateSessionTitle(sessionId, title)).then((fn) => unlisteners.push(fn));
    onMenuAction(({ action }) => {
      if (action === 'new-tab' || action === 'new-local-session') createAndAddSession();
      else if (action === 'toggle-ai-panel') useTerminalStore.getState().toggleSidebar();
    }).then((fn) => unlisteners.push(fn));

    let streamingId: string | null = null;
    onAIResponse((data: any) => {
      const store = useTerminalStore.getState();
      if (data.chunk) {
        if (!store.aiStreaming) streamingId = null;
        if (!streamingId) {
          streamingId = Date.now().toString();
          addAIMessage({ id: streamingId, role: 'assistant', content: data.chunk, timestamp: Date.now() });
        } else {
          store.appendToLastMessage(data.chunk);
        }
        setAIStreaming(true);
      }
      if (data.done) { setAIStreaming(false); streamingId = null; }
      if (data.error) {
        setAIStreaming(false);
        streamingId = null;
        addAIMessage({ id: Date.now().toString(), role: 'assistant', content: `Error: ${data.error}`, timestamp: Date.now() });
      }
    }).then((fn) => unlisteners.push(fn));

    return () => unlisteners.forEach((fn) => fn());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
