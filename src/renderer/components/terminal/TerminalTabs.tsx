import React from 'react';
import { useTerminalStore } from '../../stores/terminal-store';

export const TerminalTabs: React.FC = () => {
  const sessions = useTerminalStore((s) => s.sessions);
  const activeId = useTerminalStore((s) => s.activeSessionId);
  const setActive = useTerminalStore((s) => s.setActive);
  const removeSession = useTerminalStore((s) => s.removeSession);

  const handleNewSession = async () => {
    try {
      await window.electronAPI?.createPTY({});
    } catch (err) {
      console.error('Failed to create session:', err);
    }
  };

  const handleClose = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      await window.electronAPI?.closePTY(id);
    } catch (err) {
      console.error('Failed to close session:', err);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        background: '#252526',
        borderBottom: '1px solid #3c3c3c',
        height: '36px',
        userSelect: 'none',
        overflowX: 'auto',
      }}
    >
      {sessions.map((session) => (
        <div
          key={session.id}
          onClick={() => setActive(session.id)}
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '0 12px',
            height: '100%',
            cursor: 'pointer',
            fontSize: '12px',
            color: activeId === session.id ? '#ffffff' : '#999999',
            background: activeId === session.id ? '#1e1e1e' : 'transparent',
            borderRight: '1px solid #3c3c3c',
            whiteSpace: 'nowrap',
            gap: '6px',
          }}
          title={`${session.type === 'ssh' ? '🔗 ' : ''}${session.title}`}
        >
          <span>
            {session.type === 'ssh' ? '🔗' : '🖥'}
          </span>
          <span>{session.title}</span>
          <button
            onClick={(e) => handleClose(e, session.id)}
            style={{
              background: 'none',
              border: 'none',
              color: '#999',
              cursor: 'pointer',
              fontSize: '14px',
              padding: '0 2px',
              lineHeight: '1',
              borderRadius: '3px',
            }}
            onMouseEnter={(e) => { (e.target as HTMLButtonElement).style.background = '#3c3c3c'; }}
            onMouseLeave={(e) => { (e.target as HTMLButtonElement).style.background = 'none'; }}
          >
            ×
          </button>
        </div>
      ))}

      <button
        onClick={handleNewSession}
        style={{
          background: 'none',
          border: 'none',
          color: '#999',
          cursor: 'pointer',
          fontSize: '16px',
          padding: '0 10px',
          height: '100%',
          lineHeight: '1',
        }}
        title="New Terminal (Cmd+T)"
        onMouseEnter={(e) => { (e.target as HTMLButtonElement).style.color = '#fff'; }}
        onMouseLeave={(e) => { (e.target as HTMLButtonElement).style.color = '#999'; }}
      >
        +
      </button>
    </div>
  );
};
