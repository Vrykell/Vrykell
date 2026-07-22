import React, { useRef, useEffect, useLayoutEffect, useState, useCallback, memo } from 'react';
import { TerminalBuffer, TerminalLine } from './buffer';

const LINE_HEIGHT = 16;
const OVERSCAN = 15; // extra lines above/below viewport to avoid flicker during fast scroll

// ── Line renderer (memoized per line to avoid re-rendering unchanged lines) ──

const L = memo(function L({
  line,
  cursor,
  cx,
}: {
  line: TerminalLine;
  cursor: boolean;
  cx: number;
}) {
  const cells = line.cells;
  const end = cursor ? Math.max(cells.length, cx + 1) : cells.length;
  const cursorCol = cursor && cells[cx]?.wide && cx > 0 ? cx - 1 : cx;
  const spans: React.ReactNode[] = [];
  for (let i = 0; i < end; i++) {
    const c = i < cells.length ? cells[i] : { char: ' ' };
    if (c.wide) continue;
    spans.push(
      <span
        key={i}
        style={{
          color: cursor && i === cursorCol ? '#000' : c.fg || '#d4d4d4',
          backgroundColor: cursor && i === cursorCol ? '#fff' : c.bg || undefined,
          fontWeight: c.bold ? 'bold' : undefined,
          fontStyle: c.italic ? 'italic' : undefined,
          textDecoration: c.underline ? 'underline' : undefined,
        }}
      >
        {c.char}
      </span>,
    );
  }
  return (
    <div
      style={{
        whiteSpace: 'pre',
        fontFamily: 'Menlo,monospace',
        fontSize: 14,
        lineHeight: `${LINE_HEIGHT}px`,
        height: LINE_HEIGHT,
      }}
    >
      {spans}
    </div>
  );
});

// ── Virtual-scrolled terminal view ────────────────────────────────────────────

export const DomTerminalView: React.FC<{
  buffer: TerminalBuffer;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onInput: (e: React.FormEvent<HTMLTextAreaElement>) => void;
  onCompositionStart: () => void;
  onCompositionEnd: (e: React.CompositionEvent<HTMLTextAreaElement>) => void;
}> = ({ buffer, onKeyDown, onInput, onCompositionStart, onCompositionEnd }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [containerH, setContainerH] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const pinnedRef = useRef(true);

  // Measure viewport height (changes on window resize)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) =>
      setContainerH(entry.contentRect.height),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Auto-scroll to bottom synchronously (before paint) when new output arrives
  // and the user hasn't scrolled up to read history.
  useLayoutEffect(() => {
    if (pinnedRef.current) {
      const el = containerRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [buffer.version]);

  const onScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    setScrollTop(el.scrollTop);
    pinnedRef.current =
      el.scrollTop + el.clientHeight >= el.scrollHeight - LINE_HEIGHT * 2;
  }, []);

  const focusTextarea = () => textareaRef.current?.focus();

  // ── Visible-range calculation ──────────────────────────────────────────────
  const totalLines = buffer.lines.length;
  const effectiveH = containerH || buffer.rows * LINE_HEIGHT; // fallback on first render
  const startIdx = Math.max(0, Math.floor(scrollTop / LINE_HEIGHT) - OVERSCAN);
  const visibleCount = Math.ceil(effectiveH / LINE_HEIGHT) + OVERSCAN * 2;
  const endIdx = Math.min(totalLines, startIdx + visibleCount);

  const topSpacerH = startIdx * LINE_HEIGHT;
  const bottomSpacerH = Math.max(0, (totalLines - endIdx) * LINE_HEIGHT);

  // Build the slice to render
  const visible: React.ReactNode[] = [];
  for (let i = startIdx; i < endIdx; i++) {
    const line = buffer.lines[i];
    visible.push(
      <div key={i} data-testid="terminal-line">
        <L
          line={line}
          cursor={buffer.cursorVisible && i === buffer.cy}
          cx={buffer.cx}
        />
      </div>,
    );
  }

  return (
    <div
      ref={containerRef}
      data-testid="terminal-view"
      onClick={focusTextarea}
      onScroll={onScroll}
      style={{
        flex: 1,
        background: '#1e1e1e',
        overflowY: 'auto',
        outline: 'none',
        position: 'relative',
        // GPU layer for smooth scrolling
        willChange: 'transform',
      }}
    >
      {/* Hidden textarea: IME + keyboard proxy */}
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
          lineHeight: `${LINE_HEIGHT}px`,
          background: 'transparent',
          color: 'transparent',
        }}
      />

      {/* Virtual scroll body */}
      <div style={{ height: topSpacerH }} />
      {visible}
      <div style={{ height: bottomSpacerH }} />
    </div>
  );
};
