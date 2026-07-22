import React, { useRef, useEffect } from 'react';
import { DomTerminalView } from '../../terminal/TerminalView';
import { useDomTerminal } from '../../terminal/useDomTerminal';

interface TerminalViewProps {
  sessionId: string | null;
}

export const TerminalView: React.FC<TerminalViewProps> = ({ sessionId }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { buffer, handleKeyDown, resizeBuffer } = useDomTerminal({ sessionId });

  // Resize buffer when container width changes
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver(() => {
      const cols = Math.floor(el.clientWidth / 8.4); // approximate monospace char width
      if (cols > 0) resizeBuffer(cols);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [resizeBuffer]);

  return (
    <div ref={containerRef} style={{ flex: 1, overflow: 'hidden' }}>
      <DomTerminalView buffer={buffer} onKeyDown={handleKeyDown} />
    </div>
  );
};
