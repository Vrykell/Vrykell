import React, { useRef, useEffect } from 'react';
import { useTerminal } from '../../hooks/useTerminal';

interface TerminalViewProps {
  sessionId: string | null;
}

export const TerminalView: React.FC<TerminalViewProps> = ({ sessionId }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { initTerminal, terminal } = useTerminal({ containerRef, sessionId });

  useEffect(() => {
    const cleanup = initTerminal();
    return cleanup;
  }, [initTerminal]);

  // Focus terminal when clicking the container area
  const handleContainerClick = () => {
    terminal.current?.focus();
  };

  return (
    <div className="terminal-container" onClick={handleContainerClick}>
      <div
        ref={containerRef}
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  );
};
