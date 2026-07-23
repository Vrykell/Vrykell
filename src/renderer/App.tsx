import React, { useEffect, useRef, useState } from 'react';
import { TerminalView } from './components/terminal/TerminalView';
import { getCharWidth } from './terminal/useDomTerminal';
import { TerminalTabs } from './components/terminal/TerminalTabs';
import { RichOutput } from './components/output/RichOutput';
import { AIChatPanel } from './components/ai/AIChatPanel';
import { StatusBar } from './components/layout/StatusBar';
import { ConfirmDialog } from './components/common/ConfirmDialog';
import { useTerminalStore } from './stores/terminal-store';
import { t } from './i18n';
import { useRichContent } from './hooks/useRichContent';
import {
  createPTY, closePTY, exitApp,
  onSessionCreated, onSessionClosed, onPTYExit,
  onPTYTitleChange, onAIResponse, onMenuAction,
} from '../api';
import type { UnlistenFn } from '@tauri-apps/api/event';

const App: React.FC = () => {
  const activeSessionId = useTerminalStore((s) => s.activeSessionId);
  const sessions = useTerminalStore((s) => s.sessions);
  const outputPanelOpen = useTerminalStore((s) => s.outputPanelOpen);
  const toggleOutputPanel = useTerminalStore((s) => s.toggleOutputPanel);
  const addSession = useTerminalStore((s) => s.addSession);
  const addAIMessage = useTerminalStore((s) => s.addAIMessage);
  const setAIStreaming = useTerminalStore((s) => s.setAIStreaming);
  const updateSessionTitle = useTerminalStore((s) => s.updateSessionTitle);
  const removeSession = useTerminalStore((s) => s.removeSession);

  const [showExitDialog, setShowExitDialog] = useState(false);
  const [closingId, setClosingId] = useState<string | null>(null);

  // Closing the LAST tab goes straight to the exit dialog — showing the
  // force-close dialog first would make the user confirm twice.
  const requestCloseTab = (id: string) => {
    if (useTerminalStore.getState().sessions.length <= 1) {
      setShowExitDialog(true);
    } else {
      setClosingId(id);
    }
  };

  useRichContent(activeSessionId);

  // Estimate dimensions for initial PTY so it doesn't render at default
  // 80×24 when the actual display area is narrower (due to AI sidebar).
  // The ResizeObserver will fine-tune dimensions after mount.
  const createAndAddSession = () => {
    const terminalW = window.innerWidth - 390; // sidebar + scrollbar
    const terminalH = window.innerHeight - 100; // tab bar + status bar
    const cols = Math.max(10, Math.floor(terminalW / getCharWidth()));
    const rows = Math.max(4, Math.floor(terminalH / 16));
    return createPTY({ cols, rows })
      .then(s => addSession(s))
      .catch(err => console.error('createPTY failed:', err));
  };

  // Tauri event listeners
  useEffect(() => {
    const unlisteners: UnlistenFn[] = [];

    onSessionCreated(s => addSession(s)).then(fn => unlisteners.push(fn));
    onSessionClosed(({ sessionId }) => removeSession(sessionId)).then(fn => unlisteners.push(fn));
    onPTYExit(({ sessionId }) => removeSession(sessionId)).then(fn => unlisteners.push(fn));
    onPTYTitleChange(({ sessionId, title }) => updateSessionTitle(sessionId, title)).then(fn => unlisteners.push(fn));
    onMenuAction(({ action }) => {
      if (action === 'new-tab' || action === 'new-local-session') createAndAddSession();
      else if (action === 'toggle-ai-panel') useTerminalStore.getState().toggleSidebar();
    }).then(fn => unlisteners.push(fn));

    let streamingId: string | null = null;
    onAIResponse((data: any) => {
      const store = useTerminalStore.getState();
      if (data.chunk) {
        if (!store.aiStreaming) streamingId = null;
        if (!streamingId) { streamingId = Date.now().toString(); addAIMessage({ id: streamingId, role: 'assistant', content: data.chunk, timestamp: Date.now() }); }
        else store.appendToLastMessage(data.chunk);
        setAIStreaming(true);
      }
      if (data.done) { setAIStreaming(false); streamingId = null; }
      if (data.error) { setAIStreaming(false); streamingId = null; addAIMessage({ id: Date.now().toString(), role: 'assistant', content: `Error: ${data.error}`, timestamp: Date.now() }); }
    }).then(fn => unlisteners.push(fn));

    return () => unlisteners.forEach(fn => fn());
  }, []);

  // Auto-create first session on startup; show exit dialog when last closed.
  const didInitRef = useRef(false);
  useEffect(() => {
    if (sessions.length > 0) return;
    if (!didInitRef.current) {
      didInitRef.current = true;
      createAndAddSession();
    } else {
      setShowExitDialog(true);
    }
  }, [sessions.length]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      switch (e.key) {
        case 't': e.preventDefault(); createAndAddSession(); break;
        case 'w': e.preventDefault(); if (activeSessionId) requestCloseTab(activeSessionId); break;
        case 'j': e.preventDefault(); useTerminalStore.getState().toggleSidebar(); break;
        case 'r': if (e.shiftKey) { e.preventDefault(); toggleOutputPanel(); } break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeSessionId]);

  return (
    <>
      <div className="app-shell">
        <TerminalTabs onCloseTab={requestCloseTab} />
        <div className="app-main">
          <div className="app-terminal-area">
            <TerminalView sessionId={activeSessionId} />
            {outputPanelOpen && <RichOutput />}
            {!outputPanelOpen && (
              <button className="rich-output-toggle" onClick={toggleOutputPanel} title="Toggle Rich Output (Ctrl+Shift+R)">
                📄 Rich Output
              </button>
            )}
          </div>
          <AIChatPanel />
        </div>
        <StatusBar />
      </div>

      <ConfirmDialog
        open={showExitDialog}
        title={t.exit.title}
        message={t.exit.message}
        confirmLabel={t.exit.confirm}
        cancelLabel={t.exit.cancel}
        danger
        onConfirm={() => exitApp().catch(() => window.close())}
        onCancel={() => {
          setShowExitDialog(false);
          // Dialog reached via last-tab close: the session is still alive,
          // so cancel simply dismisses. Only recreate when the last shell
          // already exited on its own (sessions is empty).
          if (useTerminalStore.getState().sessions.length === 0) createAndAddSession();
        }}
      />

      <ConfirmDialog
        open={closingId !== null}
        title={t.closeTab.title}
        message={t.closeTab.message}
        confirmLabel={t.closeTab.confirm}
        cancelLabel={t.closeTab.cancel}
        danger
        onConfirm={() => {
          if (closingId) {
            closePTY(closingId).catch(() => {});
            setClosingId(null);
          }
        }}
        onCancel={() => setClosingId(null)}
      />
    </>
  );
};

export default App;
