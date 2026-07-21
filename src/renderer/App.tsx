import React, { useEffect } from 'react';
import { TerminalView } from './components/terminal/TerminalView';
import { TerminalTabs } from './components/terminal/TerminalTabs';
import { RichOutput } from './components/output/RichOutput';
import { AIChatPanel } from './components/ai/AIChatPanel';
import { StatusBar } from './components/layout/StatusBar';
import { useTerminalStore } from './stores/terminal-store';
import { useRichContent } from './hooks/useRichContent';
import {
  createPTY, closePTY,
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

  // Monitor terminal output for rich content detection
  useRichContent(activeSessionId);

  // Set up all Tauri event listeners once
  useEffect(() => {
    const unlisteners: UnlistenFn[] = [];

    onSessionCreated((session) => addSession(session))
      .then(fn => unlisteners.push(fn));

    onSessionClosed(({ sessionId }) => removeSession(sessionId))
      .then(fn => unlisteners.push(fn));

    onPTYExit(({ sessionId }) => removeSession(sessionId))
      .then(fn => unlisteners.push(fn));

    onPTYTitleChange(({ sessionId, title }) => updateSessionTitle(sessionId, title))
      .then(fn => unlisteners.push(fn));

    // AI responses
    let streamingMessageId: string | null = null;
    onAIResponse((data: any) => {
      if (data.chunk) {
        if (!useTerminalStore.getState().aiStreaming) streamingMessageId = null;
        if (!streamingMessageId) {
          streamingMessageId = Date.now().toString();
          addAIMessage({ id: streamingMessageId, role: 'assistant', content: data.chunk, timestamp: Date.now() });
        } else {
          useTerminalStore.getState().appendToLastMessage(data.chunk);
        }
        setAIStreaming(true);
      }
      if (data.done) { setAIStreaming(false); streamingMessageId = null; }
      if (data.error) {
        setAIStreaming(false); streamingMessageId = null;
        addAIMessage({ id: Date.now().toString(), role: 'assistant', content: `Error: ${data.error}`, timestamp: Date.now() });
      }
    }).then(fn => unlisteners.push(fn));

    // Menu actions
    onMenuAction(({ action }) => {
      if (action === 'new-tab' || action === 'new-local-session') {
        createPTY({}).then(s => addSession(s)).catch(err => console.error('createPTY failed:', err));
      } else if (action === 'toggle-ai-panel') {
        useTerminalStore.getState().toggleSidebar();
      }
    }).then(fn => unlisteners.push(fn));

    return () => { unlisteners.forEach(fn => fn()); };
  }, []); // mount once

  // Auto-create first session
  useEffect(() => {
    if (sessions.length === 0) {
      createPTY({}).then(s => addSession(s)).catch(err => console.error('createPTY failed:', err));
    }
  }, [sessions.length, addSession]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey) {
        switch (e.key) {
          case 't': e.preventDefault(); createPTY({}).then(s => addSession(s)).catch(() => {}); break;
          case 'w': e.preventDefault(); if (activeSessionId) closePTY(activeSessionId).catch(() => {}); break;
          case 'j': e.preventDefault(); useTerminalStore.getState().toggleSidebar(); break;
          case 'r': if (e.shiftKey) { e.preventDefault(); useTerminalStore.getState().toggleOutputPanel(); } break;
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeSessionId]);

  return (
    <div className="app-shell">
      <TerminalTabs />

      <div className="app-main">
        <div className="app-terminal-area" style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative' }}>
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <TerminalView sessionId={activeSessionId} />
          </div>
          {outputPanelOpen && <RichOutput />}
          {!outputPanelOpen && (
            <button
              onClick={toggleOutputPanel}
              title="Toggle Rich Output (Ctrl+Shift+R)"
              style={{
                position: 'absolute', bottom: 4, right: 8,
                background: '#333', color: '#999', border: 'none',
                borderRadius: 4, padding: '2px 8px', fontSize: 11,
                cursor: 'pointer', opacity: 0.6,
              }}
            >
              📄 Rich Output
            </button>
          )}
        </div>
        <AIChatPanel />
      </div>

      <StatusBar />
    </div>
  );
};

export default App;
