import React from 'react';
import { useTerminalStore } from '../../stores/terminal-store';

export const StatusBar: React.FC = () => {
  const sessions = useTerminalStore((s) => s.sessions);
  const activeId = useTerminalStore((s) => s.activeSessionId);
  const activeSession = sessions.find((s) => s.id === activeId);

  return (
    <div className="status-bar">
      <div className="status-bar-left">
        <div className="status-item">
          <span className={`status-dot ${activeSession?.type || 'local'}`} />
          <span>{activeSession?.type === 'ssh' ? 'SSH' : 'Local'}</span>
        </div>
        <span>{activeSession ? `${activeSession.cols}×${activeSession.rows}` : '—'}</span>
      </div>
      <div className="status-bar-right">
        <span>{sessions.length} session{sessions.length !== 1 ? 's' : ''}</span>
        <span className="status-version">AI Terminal v0.1.0</span>
      </div>
    </div>
  );
};
