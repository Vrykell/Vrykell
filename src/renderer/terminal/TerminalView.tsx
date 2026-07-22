import React, { useRef, useEffect, useLayoutEffect, useState, useCallback, memo } from 'react';
import { TerminalBuffer, TerminalLine } from './buffer';

const LINE_HEIGHT = 16;
const OVERSCAN = 15;

// ── Line renderer ──
// Memoized with a custom comparator: re-renders when the line was touched
// (line.dirty === true) OR cursor state changed.  In-place buffer mutations
// keep the same object identity, so a plain React.memo would skip streaming
// output — the dirty flag solves that.

const L = memo(
  function L({
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
          }}>{c.char}</span>,
      );
    }
    // Once rendered, the line is clean until the next write touches it.
    useEffect(() => { line.dirty = false; });
    return (
      <div style={{
        whiteSpace: 'pre',
        fontFamily: 'Menlo,monospace',
        fontSize: 14,
        lineHeight: `${LINE_HEIGHT}px`,
        height: LINE_HEIGHT,
      }}>
        {spans}
      </div>
    );
  },
  // Comparator: skip render ONLY when the line hasn't been touched AND
  // cursor state is unchanged.
  (prev, next) =>
    prev.line === next.line &&
    !next.line.dirty &&
    prev.cursor === next.cursor &&
    prev.cx === next.cx,
);

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
  const containerHRef = useRef(0);
  const scrollTopRef = useRef(0);
  const pinnedRef = useRef(true);
  // Tick bumps when scroll or resize happens — triggers re-render for
  // visible-range recalculation.  Using a counter rather than storing
  // raw pixel values in state avoids a class of flicker where two
  // renders disagree on spacer height.
  const [tick, setTick] = useState(0);

  // Measure viewport height
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    containerHRef.current = el.clientHeight;
    const ro = new ResizeObserver(([entry]) => {
      containerHRef.current = entry.contentRect.height;
      setTick(t => t + 1);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Auto-scroll when the user is pinned:
  //   • Cursor at bottom → follow output (scroll to absolute bottom).
  //   • Cursor elsewhere (TUI: Claude Code, vim, …) → keep it inside the
  //     viewport so the blinking cursor stays visible.
  //   • Not pinned (user scrolled up) → do nothing.
  useLayoutEffect(() => {
    if (!pinnedRef.current) return;
    const el = containerRef.current;
    if (!el) return;
    const h = containerHRef.current || buffer.rows * LINE_HEIGHT;
    const cursorY = buffer.cy * LINE_HEIGHT;

    if (buffer.cy >= buffer.lines.length - 1) {
      // Follow streaming / shell output at the bottom.
      scrollTopRef.current = el.scrollHeight;
      el.scrollTop = el.scrollHeight;
    } else {
      // TUI mode — keep cursor on screen.
      const visTop = el.scrollTop;
      const visBot = visTop + h - LINE_HEIGHT;
      if (cursorY < visTop || cursorY > visBot) {
        const target = Math.max(0, cursorY - Math.floor(h / 2));
        el.scrollTop = target;
        scrollTopRef.current = target;
      }
    }
  }, [buffer.version, buffer.cy, buffer.lines.length]);

  const onScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    scrollTopRef.current = el.scrollTop;
    pinnedRef.current =
      el.scrollTop + el.clientHeight >= el.scrollHeight - LINE_HEIGHT * 2;
    setTick(t => t + 1);
  }, []);

  const focusTextarea = () => textareaRef.current?.focus();

  // ── Visible-range calculation ──────────────────────────────────────────────
  // Read scrollTop from ref (always current, zero-lag) rather than React state
  // (one-frame-behind).
  const totalLines = buffer.lines.length;
  const effectiveH = containerHRef.current || buffer.rows * LINE_HEIGHT;
  const maxScroll = Math.max(0, totalLines * LINE_HEIGHT - effectiveH);

  // If pinned, use the "scrolled to bottom" position so that the FIRST render
  // of a version change already has the correct spacers.  The useLayoutEffect
  // above sets the DOM scrollTop to the same value — no visual jump.
  const scrollTop = pinnedRef.current
    ? maxScroll
    : Math.min(scrollTopRef.current, maxScroll);

  const startIdx = Math.max(0, Math.floor(scrollTop / LINE_HEIGHT) - OVERSCAN);
  const visibleCount = Math.ceil(effectiveH / LINE_HEIGHT) + OVERSCAN * 2;
  const endIdx = Math.min(totalLines, startIdx + visibleCount);
  const topSpacerH = startIdx * LINE_HEIGHT;
  const bottomSpacerH = Math.max(0, (totalLines - endIdx) * LINE_HEIGHT);

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
        overflowAnchor: 'none', // stop browser scroll-anchoring from fighting us
        outline: 'none',
        position: 'relative',
        willChange: 'transform',
      }}
    >
      {/* Hidden textarea — IME + keyboard proxy */}
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
