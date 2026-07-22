import React, { useRef, useEffect, useLayoutEffect, useState, useCallback, memo } from 'react';
import { TerminalBuffer, TerminalLine } from './buffer';

const LINE_HEIGHT = 16;
const OVERSCAN = 15;

/** Join cells in [start, end) into a string, skipping wide continuations. */
function collectText(cells: TerminalLine['cells'], start: number, end: number): string {
  let s = '';
  for (let i = start; i < end; i++) {
    const c = i < cells.length ? cells[i] : { char: ' ' };
    if (!c.wide) s += c.char;
  }
  return s;
}

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
    // Merge consecutive cells with identical visual style into a single
    // text run — collapses ~6000 spans into ~50-200, drastically reducing
    // DOM weight without affecting the underlying cell grid model.
    let runStart = 0;
    while (runStart < end) {
      // Skip wide-continuation cells (they are part of the previous CJK char).
      if (cells[runStart]?.wide) { runStart++; continue; }
      const base = cells[runStart] ?? { char: ' ' };
      let runEnd = runStart + 1;
      while (runEnd < end) {
        const nc = cells[runEnd];
        if (!nc || nc.wide) break;
        if (
          (nc.fg || undefined) !== (base.fg || undefined) ||
          (nc.bg || undefined) !== (base.bg || undefined) ||
          (nc.bold || false) !== (base.bold || false) ||
          (nc.italic || false) !== (base.italic || false) ||
          (nc.underline || false) !== (base.underline || false)
        ) break;
        runEnd++;
      }
      const runStyle = {
        color: base.fg || '#d4d4d4',
        backgroundColor: base.bg || undefined,
        fontWeight: base.bold ? 'bold' : undefined,
        fontStyle: base.italic ? 'italic' : undefined,
        textDecoration: base.underline ? 'underline' : undefined,
      };
      const cursorStyle = {
        color: base.bg || '#1e1e1e',
        backgroundColor: base.fg || '#d4d4d4',
        fontWeight: base.bold ? 'bold' : undefined,
        fontStyle: base.italic ? 'italic' : undefined,
        textDecoration: base.underline ? 'underline' : undefined,
        animation: 'terminal-cursor-blink 1s step-end infinite' as const,
      };

      // If the cursor falls inside this run we split it into three parts:
      // text before, the cursor char, text after.  This prevents a whole
      // block of text from blinking when only one cell is the cursor.
      if (cursor && cursorCol >= runStart && cursorCol < runEnd) {
        // Before cursor
        const before = collectText(cells, runStart, cursorCol);
        if (before) spans.push(<span key={`${runStart}a`} style={runStyle}>{before}</span>);
        // Cursor char
        const cursorChar = (cells[cursorCol] ?? { char: ' ' }).char;
        spans.push(<span key={`${runStart}b`} style={{ ...cursorStyle }}>{cursorChar}</span>);
        // After cursor
        const after = collectText(cells, cursorCol + 1, runEnd);
        if (after) spans.push(<span key={`${runStart}c`} style={runStyle}>{after}</span>);
      } else {
        const text = collectText(cells, runStart, runEnd);
        if (text) spans.push(<span key={runStart} style={runStyle}>{text}</span>);
      }
      runStart = runEnd;
    }
    // Once rendered, the line is clean until the next write touches it.
    useEffect(() => { line.dirty = false; });
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
  },
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
  const [tick, setTick] = useState(0);

  // Measure viewport height
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    containerHRef.current = el.clientHeight;
    const ro = new ResizeObserver(([entry]) => {
      containerHRef.current = entry.contentRect.height;
      setTick((t) => t + 1);
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
      scrollTopRef.current = el.scrollHeight;
      el.scrollTop = el.scrollHeight;
    } else {
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
    setTick((t) => t + 1);
  }, []);

  const focusTextarea = () => textareaRef.current?.focus();

  // ── Visible-range calculation ──────────────────────────────────────────────
  const totalLines = buffer.lines.length;
  const effectiveH = containerHRef.current || buffer.rows * LINE_HEIGHT;
  const maxScroll = Math.max(0, totalLines * LINE_HEIGHT - effectiveH);
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
        overflowAnchor: 'none',
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
