import React from 'react';
import { DomTerminalView } from '../../terminal/TerminalView';
import { useDomTerminal } from '../../terminal/useDomTerminal';

export const TerminalView: React.FC<{ sessionId: string | null }> = ({ sessionId }) => {
  const { buffer, onKeyDown } = useDomTerminal(sessionId);
  return <DomTerminalView buffer={buffer} onKeyDown={onKeyDown} />;
};
