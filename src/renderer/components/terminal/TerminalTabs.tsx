import React from 'react';
import { useTerminalStore } from '../../stores/terminal-store';
import { createPTY, closePTY } from '../../../api';

export const TerminalTabs: React.FC = () => {
  const sessions = useTerminalStore((s) => s.sessions);
  const activeId = useTerminalStore((s) => s.activeSessionId);
  const setActive = useTerminalStore((s) => s.setActive);

  const handleNewSession = async () => {
    try { await createPTY({}); } catch (err) { console.error('Failed to create session:', err); }
  };

  const handleClose = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try { await closePTY(id); } catch (err) { console.error('Failed to close session:', err); }
  };

  return (
    <div className="tab-bar">
      <div className="tab-bar-tabs">
        {sessions.map((session) => (
          <div
            key={session.id}
            className={`tab-item${activeId === session.id ? ' active' : ''}`}
            onClick={() => setActive(session.id)}
            title={session.title}
          >
            <span className="tab-icon">
              {session.type === 'ssh' ? '🔗' : '⬡'}
            </span>
            <span className="tab-title">{session.title}</span>
            <button
              className="tab-close"
              onClick={(e) => handleClose(e, session.id)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <div className="tab-bar-actions">
        <button className="tab-btn" onClick={handleNewSession} title="New Terminal (Ctrl+T)">
          +
        </button>
      </div>
    </div>
  );
};
