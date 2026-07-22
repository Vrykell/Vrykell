import { useRef, useEffect, useCallback, useState } from 'react';
import { TerminalBuffer } from './buffer';
import { resizePTY, writeToPTY, onPTYOutput, onPTYExit } from '../../api';

const CHAR_WIDTH = 8.4; // approximate px width of one monospace char at 14px
const LINE_HEIGHT = 16;

// Buffer cache — one TerminalBuffer per session, survives tab switches.
const bufferCache = new Map<string, TerminalBuffer>();
function getBuffer(sid: string): TerminalBuffer {
  let b = bufferCache.get(sid);
  if (!b) { b = new TerminalBuffer(); bufferCache.set(sid, b); }
  return b;
}

export function useDomTerminal(sessionId: string | null) {
  const bufRef = useRef<TerminalBuffer>(null!);
  if (sessionId) {
    const b = getBuffer(sessionId);
    if (bufRef.current !== b) bufRef.current = b;
  } else if (!bufRef.current) {
    bufRef.current = new TerminalBuffer();
  }
  const buf = bufRef.current;
  const [, bump] = useState(0);
  const sid = useRef(sessionId);
  sid.current = sessionId;

  // ── RAF-throttled renders ──────────────────────────────────────────────────
  // Streaming PTY output can fire dozens of writes per animation frame
  // (especially from TUI frameworks like Ink).  Instead of triggering a
  // React render on every single write we schedule ONE render per frame
  // via requestAnimationFrame — the terminal stays responsive without any
  // visible lag while cutting extraneous renders by ~90 %.
  const rafRef = useRef(0);
  const scheduleRender = () => {
    if (rafRef.current) return; // already queued for this frame
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      bump((n) => n + 1);
    });
  };

  // Tracks IME composition state so we don't send intermediate pinyin/romaji
  // keystrokes to the PTY.
  const composing = useRef(false);

  // Trigger a render when switching tabs so the cached buffer is shown.
  useEffect(() => { if (sessionId) scheduleRender(); }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    const un: Array<() => void> = [];

    onPTYOutput(({ sessionId: sid, events }) => {
      if (cancelled || sid !== sessionId) return;
      buf.applyEvents(events);
      scheduleRender();
    }).then(fn => { if (!cancelled) un.push(fn); else fn(); });

    onPTYExit(({ sessionId: sid, exitCode }) => {
      if (cancelled || sid !== sessionId) return;
      buf.write(`\x1b[31m[exit ${exitCode}]\x1b[0m\r\n`);
      scheduleRender();
    }).then(fn => { if (!cancelled) un.push(fn); else fn(); });

    return () => {
      cancelled = true;
      un.forEach(f => f());
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0; }
    };
  }, [sessionId]);

  // Special keys only — printable text arrives via onInput (IME-safe).
  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const s = sid.current;
    if (!s || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.isComposing || composing.current || e.key === 'Process' || (e as any).keyCode === 229) return;

    let d: string | null = null;
    if (e.key === 'Enter') d = '\r';
    else if (e.key === 'Backspace') d = '\x7f';
    else if (e.key === 'Tab') d = '\t';
    else if (e.key === 'ArrowUp') d = '\x1b[A';
    else if (e.key === 'ArrowDown') d = '\x1b[B';
    if (d !== null) { e.preventDefault(); writeToPTY(s, d).catch(() => {}); }
  }, []);

  const onInput = useCallback((e: React.FormEvent<HTMLTextAreaElement>) => {
    const s = sid.current;
    const t = e.currentTarget;
    if (!s || composing.current || !t.value) return;
    writeToPTY(s, t.value).catch(() => {});
    t.value = '';
  }, []);

  const onCompositionStart = useCallback(() => { composing.current = true; }, []);
  const onCompositionEnd = useCallback((e: React.CompositionEvent<HTMLTextAreaElement>) => {
    composing.current = false;
    // RAF fallback in case the browser doesn't fire onInput after compositionend.
    const t = e.currentTarget;
    requestAnimationFrame(() => {
      const s = sid.current;
      if (s && t.value) {
        writeToPTY(s, t.value).catch(() => {});
        t.value = '';
      }
    });
  }, []);

  // Notify PTY of terminal dimensions when the container resizes.
  const onResize = useCallback(
    (pxWidth: number, pxHeight: number) => {
      const s = sid.current;
      if (!s) return;
      const cols = Math.max(10, Math.floor(pxWidth / CHAR_WIDTH));
      const rows = Math.max(4, Math.floor(pxHeight / LINE_HEIGHT));
      buf.resize(cols);
      buf.rows = rows;
      resizePTY(s, cols, rows).catch(() => {});
    },
    [],
  );

  return { buffer: buf, onKeyDown, onInput, onCompositionStart, onCompositionEnd, onResize };
}
