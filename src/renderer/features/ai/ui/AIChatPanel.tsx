import React from 'react';
import { useTerminalStore } from '@renderer/stores/terminal-store';

export const AIChatPanel: React.FC = () => {
  const sidebarOpen = useTerminalStore((s) => s.sidebarOpen);
  const toggleSidebar = useTerminalStore((s) => s.toggleSidebar);

  if (!sidebarOpen) {
    return (
      <div
        className="tab-btn"
        onClick={toggleSidebar}
        title="AI Chat (Ctrl+J)"
        style={{
          position: 'absolute',
          right: 8,
          top: 46,
          width: 32,
          height: 32,
          fontSize: 18,
        }}
      >
        ✨
      </div>
    );
  }

  return (
    <div className="ai-sidebar">
      <div className="ai-sidebar-header">
        <div className="ai-sidebar-title">
          <span className="ai-sidebar-title-dot" />
          AI Assistant
        </div>
        <button className="ai-sidebar-close" onClick={toggleSidebar}>
          ×
        </button>
      </div>
      <div className="ai-sidebar-body">
        <div className="ai-placeholder">
          <div className="ai-placeholder-icon">✨</div>
          <div className="ai-placeholder-text">
            AI chat will be available in Phase 3.
            <br />
            Press <strong>Ctrl+J</strong> to toggle.
          </div>
        </div>
      </div>
    </div>
  );
};
