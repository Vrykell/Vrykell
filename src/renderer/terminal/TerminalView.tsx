import React, { useRef, useEffect } from 'react';
import { TerminalBuffer, TerminalLine } from './buffer';

const L = ({ line, cursor, cx }: { line: TerminalLine; cursor: boolean; cx: number }) => {
  // Ensure the cursor cell is always visible: pad cells array with spaces
  // up to the cursor position when the cursor is on this line.
  // Fixes: cursor invisible when cx >= cells.length (i.e., cursor past last char)
  const cells = line.cells;
  const end = cursor ? Math.max(cells.length, cx + 1) : cells.length;
  const spans: React.ReactNode[] = [];
  for (let i = 0; i < end; i++) {
    const c = i < cells.length ? cells[i] : { char: ' ' };
    spans.push(
      <span key={i} style={{
        color: (cursor && i === cx) ? '#000' : (c.fg || '#d4d4d4'),
        backgroundColor: (cursor && i === cx) ? '#fff' : (c.bg || undefined),
        fontWeight: c.bold ? 'bold' : undefined,
        fontStyle: c.italic ? 'italic' : undefined,
        textDecoration: c.underline ? 'underline' : undefined,
      }}>{c.char}</span>,
    );
  }
  return (
    <div style={{ whiteSpace: 'pre', fontFamily: 'Menlo,monospace', fontSize: 14, lineHeight: '16px', minHeight: 16 }}>
      {spans}
    </div>
  );
};

export const DomTerminalView: React.FC<{
  buffer: TerminalBuffer; onKeyDown: (e: React.KeyboardEvent) => void;
}> = ({ buffer, onKeyDown }) => {
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'instant' }); }, [buffer.version]);

  return (
    <div data-testid="terminal-view" tabIndex={0} onKeyDown={onKeyDown}
      style={{ flex: 1, background: '#1e1e1e', overflowY: 'auto', outline: 'none' }}>
      {buffer.lines.map((line, i) => (
        <div key={`${buffer.version}-${i}`} data-testid="terminal-line">
          <L line={line} cursor={buffer.cursorVisible && i === buffer.cy} cx={buffer.cx} />
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
};
