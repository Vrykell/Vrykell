import React, { useRef, useEffect, useLayoutEffect, useState, useCallback, memo } from 'react';
import { TerminalBuffer, TerminalLine } from '../engine/buffer';
import { getCharWidth } from '../engine/char-width';
import { useTerminal } from './hooks/useTerminal';

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
    /** cols is NO LONGER used for rendering — the line div's background fills
     *  the remaining horizontal space naturally (block element, 100% width).
     *  This means L components do NOT re-render on resize, eliminating the
     *  primary source of resize lag. */
  }) {
    const cells = line.cells;
    // Render only up to the last meaningful cell; the div's background
    // colour fills any remaining space to the right edge of the terminal.
    const contentEnd = cursor ? Math.max(cells.length, cx + 1) : cells.length;
    const end = contentEnd;
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
      // Explicit default background so the line-div's bg (#1e1e1e) never
      // bleeds through spans that have a non-default colour set by SGR.
      const runStyle = {
        color: base.fg || '#f0f0f0',
        backgroundColor: base.bg || '#000000',
        fontWeight: base.bold ? 'bold' : undefined,
        fontStyle: base.italic ? 'italic' : undefined,
        textDecoration: base.underline ? 'underline' : undefined,
      };
      const cursorStyle = {
        color: base.bg || '#000000',
        backgroundColor: base.fg || '#f0f0f0',
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
          backgroundColor: '#000000',
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
  onResize?: (pxWidth: number, pxHeight: number) => void;
}> = ({ buffer, onKeyDown, onInput, onCompositionStart, onCompositionEnd, onResize }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const containerHRef = useRef(0);
  const scrollTopRef = useRef(0);
  const pinnedRef = useRef(true);
  /** Timestamp of the last keystroke/input — used to reject the browser's
   *  "scroll the focused off-screen textarea into view" jump that fires
   *  right after input while the user is scrolled up reading history. */
  const lastInputRef = useRef(0);
  const [tick, setTick] = useState(0);

  // Keep a mutable ref to the latest onResize so the ResizeObserver
  // (created once, empty deps) never calls a stale closure.
  const onResizeRef = useRef(onResize);
  onResizeRef.current = onResize;

  // Measure viewport height
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    containerHRef.current = el.clientHeight;
    const ro = new ResizeObserver(([entry]) => {
      containerHRef.current = entry.contentRect.height;
      // When the container grows, maxScroll shrinks — but the DOM element's
      // actual scrollTop stays at its old (larger) value while the render
      // computes slices from the new maxScroll.  That desync leaves stale
      // content visible at the bottom.  Re-pin the DOM scroll position here
      // so the viewport and the rendered slice stay aligned.
      if (pinnedRef.current) {
        el.scrollTop = el.scrollHeight;
        scrollTopRef.current = el.scrollTop;
      }
      setTick((t) => t + 1);
      onResizeRef.current?.(entry.contentRect.width, entry.contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const prevLineCountRef = useRef(buffer.lines.length);

  // Auto-scroll logic:
  //   • New lines arrived AND cursor is at bottom → scroll to follow output.
  //   • Cursor moved off-screen in a TUI → bring it back into view.
  //   • Character writes (no new lines) → NEVER auto-scroll, even if near bottom.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const h = containerHRef.current || buffer.rows * LINE_HEIGHT;
    const cursorY = buffer.cy * LINE_HEIGHT;
    const lineCount = buffer.lines.length;
    const linesAdded = lineCount > prevLineCountRef.current;
    prevLineCountRef.current = lineCount;

    if (linesAdded && buffer.cy >= lineCount - 1 && pinnedRef.current) {
      // New output arrived while user is following the bottom — stay at bottom.
      scrollTopRef.current = el.scrollHeight;
      el.scrollTop = el.scrollHeight;
    } else if (pinnedRef.current) {
      // User hasn't scrolled away — keep cursor in viewport if it moved
      // (important for TUIs that reposition the cursor within the screen).
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
    // Browser-initiated jump guard: while the user is scrolled up reading
    // history, typing makes the browser scroll the off-screen hidden
    // textarea (positioned at the cursor, near the bottom) into view.
    // That downward scroll is not user intent — undo it.  Upward scrolls
    // (reading further back) are always honored.
    if (
      !pinnedRef.current &&
      Date.now() - lastInputRef.current < 150 &&
      el.scrollTop > scrollTopRef.current + LINE_HEIGHT
    ) {
      el.scrollTop = scrollTopRef.current;
      return;
    }
    scrollTopRef.current = el.scrollTop;
    pinnedRef.current =
      el.scrollTop + el.clientHeight >= el.scrollHeight - LINE_HEIGHT * 5;
    setTick((t) => t + 1);
  }, []);

  const focusTextarea = () => textareaRef.current?.focus();

  // Position the hidden textarea so IME composition windows follow the TUI
  // cursor.  If the textarea stays at (0,0) the IME draws its candidate box
  // and inline pre-edit text at the wrong location, producing a "second
  // cursor" effect during CJK input.
  const charW = getCharWidth();
  const cursorLine = buffer.lines[buffer.cy];
  const cursorCol =
    cursorLine?.cells[buffer.cx]?.wide && buffer.cx > 0 ? buffer.cx - 1 : buffer.cx;
  const textareaLeft = cursorCol * charW;

  // ── Visible-range calculation ──────────────────────────────────────────────
  const totalLines = buffer.lines.length;
  const effectiveH = containerHRef.current || buffer.rows * LINE_HEIGHT;
  const maxScroll = Math.max(0, totalLines * LINE_HEIGHT - effectiveH);
  // Pinned means "following the bottom" — render the bottom slice directly
  // (single pass, no blank-frame lag).  When NOT pinned, always render from
  // the ACTUAL scroll position: the former "nearBottom" clause also snapped
  // unpinned users within 5 lines of the bottom to maxScroll on any
  // re-render, teleporting the viewport away from where they were reading.
  const scrollTop = pinnedRef.current
    ? maxScroll
    : Math.min(scrollTopRef.current, maxScroll);

  // Cursor row in VIEWPORT coordinates for the hidden textarea (negative
  // when the cursor is scrolled off-screen — nothing can scroll to it).
  const textareaTop = buffer.cy * LINE_HEIGHT - scrollTop;

  const startIdx = Math.max(0, Math.floor(scrollTop / LINE_HEIGHT) - OVERSCAN);
  const visibleCount = Math.ceil(effectiveH / LINE_HEIGHT) + OVERSCAN * 2;
  const endIdx = Math.min(totalLines, startIdx + visibleCount);
  const topSpacerH = startIdx * LINE_HEIGHT;
  const bottomSpacerH = Math.max(0, (totalLines - endIdx) * LINE_HEIGHT);

  const visible: React.ReactNode[] = [];
  for (let i = startIdx; i < endIdx; i++) {
    const line = buffer.lines[i];
    visible.push(
      <div key={i} data-testid="terminal-line" style={{ contentVisibility: 'auto' }}>
        <L
          line={line}
          cursor={buffer.cursorVisible && i === buffer.cy}
          cx={buffer.cx}
        />
      </div>,
    );
  }

  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex' }}>
    <div
      ref={containerRef}
      data-testid="terminal-view"
      onClick={focusTextarea}
      onScroll={onScroll}
      style={{
        flex: 1,
        background: '#000000',
        overflowY: 'auto',
        overflowAnchor: 'none',
        outline: 'none',
        position: 'relative',
        // GPU compositing: own layer, no full-page repaints on scroll/content updates.
        willChange: 'scroll-position',
        contain: 'layout style paint',  // NOT "strict" — we need size to grow with content
        transform: 'translateZ(0)',
      }}
    >
      {/* Virtual scroll body */}
      <div style={{ height: topSpacerH }} />
      {visible}
      <div style={{ height: bottomSpacerH }} />
    </div>

    {/* Hidden textarea — IME + keyboard proxy.  Lives OUTSIDE the scroll
        container: Chromium scrolls the focused caret into view on input,
        and inside the scroller that fired as an unsolicited viewport jump
        whenever the user typed while scrolled up.  Here nothing is
        scrollable, so input can never move the viewport.  Positioned at
        the cursor's viewport-relative coordinates so the IME candidate
        window still tracks the cursor. */}
    <textarea
      ref={textareaRef}
      data-testid="terminal-textarea"
      autoFocus
      rows={1}
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      onKeyDown={(e) => {
        // Only keys that echo text / move the caret can trigger the
        // browser's textarea-reveal scroll — navigation keys must not
        // arm the guard (PageDown scrolling is legitimate user intent).
        if (e.key.length === 1 || e.key === 'Enter' || e.key === 'Backspace' || e.key === 'Tab') {
          lastInputRef.current = Date.now();
        }
        onKeyDown(e);
      }}
      onInput={(e) => {
        lastInputRef.current = Date.now();
        onInput(e);
      }}
      onCompositionStart={onCompositionStart}
      onCompositionEnd={onCompositionEnd}
      style={{
        position: 'absolute',
        left: textareaLeft,
        top: textareaTop,
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
    </div>
  );
};

/**
 * Connected terminal view for a single session.
 * Wires the VT engine (useTerminal) to the DOM renderer (DomTerminalView).
 */
export const TerminalView: React.FC<{ sessionId: string | null }> = ({ sessionId }) => {
  const { buffer, onKeyDown, onInput, onCompositionStart, onCompositionEnd, onResize } =
    useTerminal(sessionId);
  return (
    <DomTerminalView
      buffer={buffer}
      onKeyDown={onKeyDown}
      onInput={onInput}
      onCompositionStart={onCompositionStart}
      onCompositionEnd={onCompositionEnd}
      onResize={onResize}
    />
  );
};
