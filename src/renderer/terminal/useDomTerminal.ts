import { useRef, useEffect, useCallback, useState } from 'react';
import { TerminalBuffer } from './buffer';
import { writeToPTY, onPTYOutput, onPTYExit } from '../../api';

export function useDomTerminal(sessionId: string | null) {
  const buf = useRef(new TerminalBuffer()).current;
  const [, bump] = useState(0);
  const sid = useRef(sessionId);
  sid.current = sessionId;

  // Tracks IME composition state so we don't send intermediate pinyin/romaji
  // keystrokes to the PTY.
  const composing = useRef(false);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    const un: Array<() => void> = [];

    onPTYOutput(({ sessionId: sid, data }) => {
      if (cancelled || sid !== sessionId) return;
      buf.write(data);
      bump(n => n + 1);
    }).then(fn => { if (!cancelled) un.push(fn); else fn(); });

    onPTYExit(({ sessionId: sid, exitCode }) => {
      if (cancelled || sid !== sessionId) return;
      buf.write(`\x1b[31m[exit ${exitCode}]\x1b[0m\r\n`);
      bump(n => n + 1);
    }).then(fn => { if (!cancelled) un.push(fn); else fn(); });

    return () => { cancelled = true; un.forEach(f => f()); };
  }, [sessionId]);

  // Special keys only — printable text arrives via onInput (IME-safe).
  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const s = sid.current;
    if (!s || e.metaKey || e.ctrlKey || e.altKey) return;
    // If IME is actively composing, skip — onCompositionEnd will flush the text.
    if (e.isComposing || composing.current || e.key === 'Process' || (e as any).keyCode === 229) return;

    let d: string | null = null;
    if (e.key === 'Enter') d = '\r';
    else if (e.key === 'Backspace') d = '\x7f';
    else if (e.key === 'Tab') d = '\t';
    else if (e.key === 'ArrowUp') d = '\x1b[A';
    else if (e.key === 'ArrowDown') d = '\x1b[B';
    if (d !== null) { e.preventDefault(); writeToPTY(s, d).catch(() => {}); }
  }, []);

  // onInput fires for EVERY text insertion into the textarea, including
  // IME-committed characters (Chinese / Japanese / etc.) and directly-typed
  // ASCII.  We send the whole value and then clear it so the next keystroke
  // re-fills the textarea.
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
    // Some browsers update the textarea value BEFORE firing compositionend,
    // others do it AFTER.  Use rAF to flush whatever ends up in the textarea.
    const t = e.currentTarget;
    requestAnimationFrame(() => {
      const s = sid.current;
      if (s && t.value) {
        writeToPTY(s, t.value).catch(() => {});
        t.value = '';
      }
    });
  }, []);

  return { buffer: buf, onKeyDown, onInput, onCompositionStart, onCompositionEnd };
}
