import React, { useEffect } from 'react';
import { TerminalView } from './components/terminal/TerminalView';
import { TerminalTabs } from './components/terminal/TerminalTabs';
import { RichOutput } from './components/output/RichOutput';
import { AIChatPanel } from './components/ai/AIChatPanel';
import { StatusBar } from './components/layout/StatusBar';
import { useTerminalStore } from './stores/terminal-store';

const App: React.FC = () => {
  const activeSessionId = useTerminalStore((s) => s.activeSessionId);
  const sessions = useTerminalStore((s) => s.sessions);
  const addSession = useTerminalStore((s) => s.addSession);
  const addAIMessage = useTerminalStore((s) => s.addAIMessage);
  const setAIStreaming = useTerminalStore((s) => s.setAIStreaming);
  const updateSessionTitle = useTerminalStore((s) => s.updateSessionTitle);

  // Listen for session creation events
  useEffect(() => {
    const disposer = window.electronAPI?.onSessionCreated((session) => {
      addSession(session);
    });
    return () => disposer?.();
  }, [addSession]);

  // Listen for title changes
  useEffect(() => {
    const disposer = window.electronAPI?.onPTYTitleChange(({ sessionId, title }) => {
      updateSessionTitle(sessionId, title);
    });
    return () => disposer?.();
  }, [updateSessionTitle]);

  // Listen for AI responses (streaming — append chunks to last message)
  useEffect(() => {
    let streamingMessageId: string | null = null;

    const disposer = window.electronAPI?.onAIResponse((data: any) => {
      if (data.chunk) {
        setAIStreaming(true);
        if (!streamingMessageId) {
          streamingMessageId = Date.now().toString();
          addAIMessage({
            id: streamingMessageId,
            role: 'assistant',
            content: data.chunk,
            timestamp: Date.now(),
          });
        } else {
          // Append chunk to existing streaming message
          useTerminalStore.getState().appendToLastMessage(data.chunk);
        }
      }
      if (data.done) {
        setAIStreaming(false);
        streamingMessageId = null;
      }
      if (data.error) {
        setAIStreaming(false);
        streamingMessageId = null;
        addAIMessage({
          id: Date.now().toString(),
          role: 'assistant',
          content: `Error: ${data.error}`,
          timestamp: Date.now(),
        });
      }
    });
    return () => disposer?.();
  }, [addAIMessage, setAIStreaming]);

  // Listen for menu actions
  useEffect(() => {
    const disposer = window.electronAPI?.onMenuAction(({ action }) => {
      switch (action) {
        case 'new-tab':
        case 'new-local-session':
          window.electronAPI?.createPTY({});
          break;
        case 'toggle-ai-panel':
          useTerminalStore.getState().toggleSidebar();
          break;
      }
    });
    return () => disposer?.();
  }, []);

  // Auto-create first session
  useEffect(() => {
    if (sessions.length === 0) {
      window.electronAPI?.createPTY({});
    }
  }, [sessions.length]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey) {
        switch (e.key) {
          case 't':
            e.preventDefault();
            window.electronAPI?.createPTY({});
            break;
          case 'w':
            e.preventDefault();
            if (activeSessionId) {
              window.electronAPI?.closePTY(activeSessionId);
            }
            break;
          case 'j':
            e.preventDefault();
            useTerminalStore.getState().toggleSidebar();
            break;
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeSessionId]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        background: '#1e1e1e',
        color: '#d4d4d4',
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      }}
    >
      <TerminalTabs />

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative' }}>
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
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
