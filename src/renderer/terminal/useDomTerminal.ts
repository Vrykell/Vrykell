import { useRef, useEffect, useCallback, useState } from 'react';
import { TerminalBuffer } from './buffer';
import { writeToPTY, onPTYOutput, onPTYExit } from '../../api';

export function useDomTerminal(sessionId: string | null) {
  const buf = useRef(new TerminalBuffer()).current;
  const [, bump] = useState(0);
  const sid = useRef(sessionId);
  sid.current = sessionId;

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

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    const s = sid.current;
    if (!s || e.metaKey || e.ctrlKey || e.altKey) return;
    let d: string | null = null;
    if (e.key === 'Enter') d = '\r';
    else if (e.key === 'Backspace') d = '\x7f';
    else if (e.key === 'Tab') d = '\t';
    else if (e.key === 'ArrowUp') d = '\x1b[A';
    else if (e.key === 'ArrowDown') d = '\x1b[B';
    else if (e.key.length === 1) d = e.key;
    if (d !== null) { e.preventDefault(); writeToPTY(s, d).catch(() => {}); }
  }, []);

  return { buffer: buf, onKeyDown };
}
