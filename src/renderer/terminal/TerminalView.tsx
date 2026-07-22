import React, { useRef, useEffect } from 'react';
import { TerminalBuffer, TerminalLine } from './buffer';

const L = ({ line, cursor, cx }: { line: TerminalLine; cursor: boolean; cx: number }) => {
  const cells = line.cells;
  const end = cursor ? Math.max(cells.length, cx + 1) : cells.length;
  // Show the cursor on the primary cell when it would otherwise land on
  // a wide continuation (which is skipped during rendering).
  const cursorCol = cursor && cells[cx]?.wide && cx > 0 ? cx - 1 : cx;
  const spans: React.ReactNode[] = [];
  for (let i = 0; i < end; i++) {
    const c = i < cells.length ? cells[i] : { char: ' ' };
    if (c.wide) continue;
    spans.push(
      <span key={i} style={{
        color: (cursor && i === cursorCol) ? '#000' : (c.fg || '#d4d4d4'),
        backgroundColor: (cursor && i === cursorCol) ? '#fff' : (c.bg || undefined),
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
  buffer: TerminalBuffer;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onInput: (e: React.FormEvent<HTMLTextAreaElement>) => void;
  onCompositionStart: () => void;
  onCompositionEnd: (e: React.CompositionEvent<HTMLTextAreaElement>) => void;
}> = ({ buffer, onKeyDown, onInput, onCompositionStart, onCompositionEnd }) => {
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'instant' }); }, [buffer.version]);

  // Clicking anywhere in the terminal steers focus to the hidden textarea so
  // that IME composition can work (browsers require an editable element).
  const focusTextarea = () => textareaRef.current?.focus();

  return (
    <div data-testid="terminal-view" onClick={focusTextarea}
      style={{ flex: 1, background: '#1e1e1e', overflowY: 'auto', outline: 'none', position: 'relative' }}>
      {/* Hidden textarea that proxies all keyboard / IME input.
          Positioned off-screen so it stays focusable but invisible. */}
      <textarea
        ref={textareaRef}
        data-testid="terminal-textarea"
        autoFocus
        rows={1}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        onKeyDown={onKeyDown}
        onInput={onInput}
        onCompositionStart={onCompositionStart}
        onCompositionEnd={onCompositionEnd}
        // Positioned at the bottom-left of the terminal viewport so that
        // macOS IME candidate windows appear near the typing area.  The
        // textarea itself is kept nearly invisible but still occupies space
        // so the browser considers it "on screen".
        style={{
          position: 'absolute',
          left: 0,
          bottom: 0,
          width: '1ch',
          height: '1em',
          opacity: 0,
          resize: 'none',
          border: 'none',
          outline: 'none',
          caretColor: 'transparent',
          fontFamily: 'Menlo, monospace',
          fontSize: 14,
          lineHeight: '16px',
          background: 'transparent',
          color: 'transparent',
        }}
      />
      {buffer.lines.map((line, i) => (
        <div key={`${buffer.version}-${i}`} data-testid="terminal-line">
          <L line={line} cursor={buffer.cursorVisible && i === buffer.cy} cx={buffer.cx} />
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
};
