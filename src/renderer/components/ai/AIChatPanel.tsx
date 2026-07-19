import React from 'react';
import { useTerminalStore } from '../../stores/terminal-store';

/**
 * AI Chat Panel placeholder. Phase 3 will implement full Claude API integration.
 */
export const AIChatPanel: React.FC = () => {
  const sidebarOpen = useTerminalStore((s) => s.sidebarOpen);
  const toggleSidebar = useTerminalStore((s) => s.toggleSidebar);

  if (!sidebarOpen) {
    return (
      <div
        onClick={toggleSidebar}
        style={{
          position: 'absolute',
          right: 0,
          top: '36px',
          bottom: '24px',
          width: '36px',
          background: '#252526',
          borderLeft: '1px solid #3c3c3c',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          color: '#999',
          fontSize: '14px',
          writingMode: 'vertical-rl',
          userSelect: 'none',
        }}
      >
        AI Chat
      </div>
    );
  }

  return (
    <div
      style={{
        width: '320px',
        background: '#252526',
        borderLeft: '1px solid #3c3c3c',
        display: 'flex',
        flexDirection: 'column',
        fontSize: '13px',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          borderBottom: '1px solid #3c3c3c',
        }}
      >
        <span style={{ color: '#fff', fontWeight: 600 }}>AI Assistant</span>
        <button
          onClick={toggleSidebar}
          style={{ background: 'none', border: 'none', color: '#999', cursor: 'pointer', fontSize: '16px' }}
        >
          ×
        </button>
      </div>

      <div style={{ flex: 1, padding: '12px', color: '#999', overflow: 'auto' }}>
        <p>AI chat will be available in Phase 3.</p>
        <p style={{ marginTop: '8px' }}>Features coming:</p>
        <ul style={{ paddingLeft: '16px', marginTop: '4px' }}>
          <li>Claude API integration</li>
          <li>Streaming responses</li>
          <li>Rich Markdown/LaTeX rendering</li>
          <li>Terminal context awareness</li>
        </ul>
      </div>

      <div style={{ padding: '8px', borderTop: '1px solid #3c3c3c' }}>
        <input
          type="text"
          placeholder="Ask AI (Phase 3)..."
          disabled
          style={{
            width: '100%',
            padding: '6px 8px',
            background: '#3c3c3c',
            border: '1px solid #555',
            borderRadius: '4px',
            color: '#999',
            fontSize: '12px',
            outline: 'none',
          }}
        />
      </div>
    </div>
  );
};
