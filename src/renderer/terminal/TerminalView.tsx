import React, { useRef, useEffect, memo } from 'react';
import { TerminalBuffer, TerminalLine } from './buffer';

const L = memo(function L({ line, cursor, cx }: { line: TerminalLine; cursor: boolean; cx: number }) {
  return (
    <div style={{ whiteSpace: 'pre', fontFamily: 'Menlo,monospace', fontSize: 14, lineHeight: '16px', minHeight: 16 }}>
      {line.cells.map((c, i) => (
        <span key={i} style={{
          color: c.fg || '#d4d4d4',
          backgroundColor: (cursor && i === cx) ? '#fff' : (c.bg || undefined),
          fontWeight: c.bold ? 'bold' : undefined,
          fontStyle: c.italic ? 'italic' : undefined,
          textDecoration: c.underline ? 'underline' : undefined,
        }}>{c.char}</span>
      ))}
    </div>
  );
});

export const DomTerminalView: React.FC<{
  buffer: TerminalBuffer; onKeyDown: (e: React.KeyboardEvent) => void;
}> = ({ buffer, onKeyDown }) => {
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'instant' }); }, [buffer.version]);

  return (
    <div tabIndex={0} onKeyDown={onKeyDown}
      style={{ flex: 1, background: '#1e1e1e', overflowY: 'auto', outline: 'none' }}>
      {buffer.lines.map((line, i) => (
        <L key={i} line={line} cursor={i === buffer.cy} cx={buffer.cx} />
      ))}
      <div ref={bottomRef} />
    </div>
  );
};
