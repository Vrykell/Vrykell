import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { ptySpawn, ptyWrite, ptyResize, ptyClose, onPtyOutput, onPtyExit } from '../lib/pty';
import type { UnlistenFn } from '@tauri-apps/api/event';

export function useXterm(onReady: (sessionId: string) => void) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const term = new Terminal({
      fontFamily: 'Menlo, monospace',
      fontSize: 13,
      cursorBlink: true,
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    fit.fit();

    let sessionId: string | null = null;
    let disposed = false;
    const unlisteners: UnlistenFn[] = [];

    ptySpawn(term.cols, term.rows).then((id) => {
      if (disposed) { ptyClose(id); return; }
      sessionId = id;
      onReadyRef.current(id);
    });

    const dataSub = term.onData((data) => {
      if (sessionId) ptyWrite(sessionId, data).catch(() => {});
    });

    onPtyOutput((id, data) => {
      if (id === sessionId) term.write(data);
    }).then((u) => unlisteners.push(u));
    onPtyExit((id) => {
      if (id === sessionId) term.write('\r\n\x1b[31m[进程已退出]\x1b[0m\r\n');
    }).then((u) => unlisteners.push(u));

    const ro = new ResizeObserver(() => {
      fit.fit();
      if (sessionId && term.cols > 0 && term.rows > 0) {
        ptyResize(sessionId, term.cols, term.rows).catch(() => {});
      }
    });
    ro.observe(el);

    return () => {
      disposed = true;
      ro.disconnect();
      dataSub.dispose();
      unlisteners.forEach((u) => u());
      if (sessionId) ptyClose(sessionId).catch(() => {});
      term.dispose();
    };
  }, []);

  return containerRef;
}
