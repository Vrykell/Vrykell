import React, { useRef, useEffect } from 'react';
import { useTerminal } from '../../hooks/useTerminal';
import { useTerminalStore } from '../../stores/terminal-store';

interface TerminalViewProps {
  sessionId: string | null;
}

export const TerminalView: React.FC<TerminalViewProps> = ({ sessionId }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { initTerminal, search: termSearch, clear: termClear } = useTerminal({
    containerRef,
    sessionId,
  });
  const activeSessionId = useTerminalStore((s) => s.activeSessionId);

  // Initialize terminal on mount
  useEffect(() => {
    const cleanup = initTerminal();
    return cleanup;
  }, [initTerminal]);

  // Focus terminal when clicking the container
  const handleClick = () => {
    // xterm.js handles focus internally
  };

  return (
    <div
      className="terminal-container"
      style={{
        flex: 1,
        overflow: 'hidden',
        padding: '2px',
        background: '#1e1e1e',
      }}
    >
      <div
        ref={containerRef}
        onClick={handleClick}
        style={{
          width: '100%',
          height: '100%',
        }}
      />
    </div>
  );
};
