import { useRef, useEffect, useCallback, useState } from 'react';
import { TerminalBuffer } from './buffer';
import { writeToPTY, resizePTY, onPTYOutput, onPTYExit } from '../../api';

interface UseDomTerminalOptions {
  sessionId: string | null;
}

export function useDomTerminal({ sessionId }: UseDomTerminalOptions) {
  const bufferRef = useRef<TerminalBuffer>(new TerminalBuffer(80));
  const [, forceUpdate] = useState(0);
  const sessionIdRef = useRef<string | null>(sessionId);
  sessionIdRef.current = sessionId;

  // Force React re-render when buffer changes (throttled)
  const scheduleUpdate = useCallback(() => {
    forceUpdate(n => n + 1);
  }, []);

  useEffect(() => {
    const buffer = bufferRef.current;
    let rafPending = false;

    const scheduleRaf = () => {
      if (!rafPending) {
        rafPending = true;
        requestAnimationFrame(() => {
          rafPending = false;
          scheduleUpdate();
        });
      }
    };

    // PTY output → buffer
    const outputPromise = onPTYOutput(({ sessionId: sid, data }) => {
      if (sid !== sessionIdRef.current) return;
      buffer.write(data);
      scheduleRaf();
    });

    // PTY exit
    const exitPromise = onPTYExit(({ sessionId: sid, exitCode }) => {
      if (sid !== sessionIdRef.current) return;
      buffer.write(`\r\n\x1b[31m[Process exited with code: ${exitCode}]\x1b[0m\r\n`);
      scheduleRaf();
    });

    let unlistenOutput: (() => void) | null = null;
    let unlistenExit: (() => void) | null = null;

    outputPromise.then(fn => { unlistenOutput = fn; });
    exitPromise.then(fn => { unlistenExit = fn; });

    return () => {
      unlistenOutput?.();
      unlistenExit?.();
    };
  }, [scheduleUpdate]);

  // Resize buffer when container resizes
  const resizeBuffer = useCallback((cols: number) => {
    bufferRef.current.resize(cols);
    scheduleUpdate();
  }, [scheduleUpdate]);

  // Keyboard → PTY
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    e.preventDefault();

    if (e.key === 'Enter') {
      writeToPTY(sid, '\r').catch(() => {});
    } else if (e.key === 'Backspace') {
      writeToPTY(sid, '\x7f').catch(() => {});
    } else if (e.key === 'ArrowUp') {
      writeToPTY(sid, '\x1b[A').catch(() => {});
    } else if (e.key === 'ArrowDown') {
      writeToPTY(sid, '\x1b[B').catch(() => {});
    } else if (e.key === 'ArrowLeft') {
      writeToPTY(sid, '\x1b[D').catch(() => {});
    } else if (e.key === 'ArrowRight') {
      writeToPTY(sid, '\x1b[C').catch(() => {});
    } else if (e.key === 'Tab') {
      writeToPTY(sid, '\t').catch(() => {});
    } else if (e.ctrlKey && e.key === 'c') {
      writeToPTY(sid, '\x03').catch(() => {});
    } else if (e.ctrlKey && e.key === 'd') {
      writeToPTY(sid, '\x04').catch(() => {});
    } else if (e.metaKey || e.ctrlKey) {
      // Don't capture other meta/ctrl shortcuts
      return;
    } else if (e.key.length === 1) {
      writeToPTY(sid, e.key).catch(() => {});
    }
  }, []);

  return {
    buffer: bufferRef.current,
    handleKeyDown,
    resizeBuffer,
  };
}
