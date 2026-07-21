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
} from '../../api';
import type { UnlistenFn } from '@tauri-apps/api/event';

const App: React.FC = () => {
  const activeSessionId = useTerminalStore((s) => s.activeSessionId);
  const sessions = useTerminalStore((s) => s.sessions);
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
        createPTY({}).catch(err => console.error('createPTY failed:', err));
      } else if (action === 'toggle-ai-panel') {
        useTerminalStore.getState().toggleSidebar();
      }
    }).then(fn => unlisteners.push(fn));

    return () => { unlisteners.forEach(fn => fn()); };
  }, []); // mount once

  // Auto-create first session
  useEffect(() => {
    if (sessions.length === 0) {
      createPTY({}).catch(err => console.error('createPTY failed:', err));
    }
  }, [sessions.length]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey) {
        switch (e.key) {
          case 't': e.preventDefault(); createPTY({}).catch(() => {}); break;
          case 'w': e.preventDefault(); if (activeSessionId) closePTY(activeSessionId).catch(() => {}); break;
          case 'j': e.preventDefault(); useTerminalStore.getState().toggleSidebar(); break;
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
        <div className="app-terminal-area">
          <TerminalView sessionId={activeSessionId} />
          <RichOutput />
        </div>
        <AIChatPanel />
      </div>

      <StatusBar />
    </div>
  );
};

export default App;
