import React from 'react';
import { useTerminalStore } from '../../stores/terminal-store';

export const StatusBar: React.FC = () => {
  const sessions = useTerminalStore((s) => s.sessions);
  const activeId = useTerminalStore((s) => s.activeSessionId);
  const activeSession = sessions.find((s) => s.id === activeId);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: '24px',
        padding: '0 12px',
        background: '#007acc',
        color: '#ffffff',
        fontSize: '12px',
        userSelect: 'none',
      }}
    >
      <div style={{ display: 'flex', gap: '16px' }}>
        <span>AI Terminal v0.1.0</span>
        {activeSession && (
          <>
            <span>{activeSession.type === 'ssh' ? 'SSH' : 'Local'}</span>
            <span>{activeSession.cols}×{activeSession.rows}</span>
          </>
        )}
      </div>
      <div>
        <span>{sessions.length} session{sessions.length !== 1 ? 's' : ''}</span>
      </div>
    </div>
  );
};
