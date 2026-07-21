import { useEffect, useRef, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { useTerminalStore } from '../stores/terminal-store';
import { writeToPTY, resizePTY, onPTYOutput, onPTYExit } from '../../api';

interface UseTerminalOptions {
  containerRef: React.RefObject<HTMLDivElement | null>;
  sessionId: string | null;
}

export function useTerminal({ containerRef, sessionId }: UseTerminalOptions) {
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  // Extract only terminal-relevant settings to avoid unnecessary
  // terminal recreation when non-terminal settings change
  const terminalSettings = useTerminalStore((s) => s.settings.terminal);

  // Initialize xterm.js instance (runs once per mount)
  const initTerminal = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    // Clean up previous instance (xterm.dispose() handles its own DOM cleanup)
    if (terminalRef.current) {
      terminalRef.current.dispose();
      terminalRef.current = null;
    }

    const term = new Terminal({
      fontSize: terminalSettings.fontSize,
      fontFamily: terminalSettings.fontFamily,
      cursorStyle: terminalSettings.cursorStyle,
      cursorBlink: terminalSettings.cursorBlink,
      scrollback: terminalSettings.scrollback,
      allowProposedApi: true,
      allowTransparency: true,
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#ffffff',
        selectionBackground: '#264f78',
        black: '#000000',
        red: '#cd3131',
        green: '#0dbc79',
        yellow: '#e5e510',
        blue: '#2472c8',
        magenta: '#bc3fbc',
        cyan: '#11a8cd',
        white: '#e5e5e5',
        brightBlack: '#666666',
        brightRed: '#f14c4c',
        brightGreen: '#23d18b',
        brightYellow: '#f5f543',
        brightBlue: '#3b8eea',
        brightMagenta: '#d670d6',
        brightCyan: '#29b8db',
        brightWhite: '#ffffff',
      },
    });

    // Addons
    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();
    const unicodeAddon = new Unicode11Addon();

    term.loadAddon(fitAddon);
    term.loadAddon(searchAddon);
    term.loadAddon(unicodeAddon);
    term.unicode.activeVersion = '11';

    // NOTE: Tauri on macOS uses WKWebView (Safari), which has known rendering
    // issues with xterm.js WebGL addon. DOM renderer is the safe default.
    // On Windows (WebView2) and Linux (WebKitGTK), WebGL works correctly.
    // To enable WebGL: install @xterm/addon-webgl and uncomment below.
    // try { term.loadAddon(new WebglAddon()); } catch { /* DOM fallback */ }

    term.open(container);

    // Defer the initial fit until the browser has laid out the container.
    requestAnimationFrame(() => {
      try {
        fitAddon.fit();
        term.focus();
      } catch { /* container may be gone */ }
    });

    terminalRef.current = term;
    fitAddonRef.current = fitAddon;
    searchAddonRef.current = searchAddon;

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      try { fitAddon.fit(); } catch { /* terminal may be disposed */ }
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      term.dispose();
    };
  }, [containerRef, terminalSettings]);

  // Keep sessionId in a ref so event listeners always have latest value
  const sessionIdRef = useRef<string | null>(sessionId);
  sessionIdRef.current = sessionId;

  // Set up PTY I/O event listeners ONCE (global listeners, filter by sessionId)
  useEffect(() => {
    const term = terminalRef.current;
    if (!term) return;

    const unlisteners: Array<() => void> = [];

    // PTY output — listen globally, write when sessionId matches
    onPTYOutput(({ sessionId: sid, data }) => {
      if (sid === sessionIdRef.current && terminalRef.current) {
        terminalRef.current.write(data);
      }
    }).then(fn => unlisteners.push(fn));

    // PTY exit — listen globally
    onPTYExit(({ sessionId: sid, exitCode }) => {
      if (sid === sessionIdRef.current && terminalRef.current) {
        terminalRef.current.write(`\r\n\x1b[31m[Process exited with code: ${exitCode}]\x1b[0m\r\n`);
      }
    }).then(fn => unlisteners.push(fn));

    return () => unlisteners.forEach(fn => fn());
  }, []); // set up once, never re-create

  // Wire terminal input → PTY (depends on sessionId)
  useEffect(() => {
    const term = terminalRef.current;
    if (!term || !sessionId) return;

    const onDataDisposer = term.onData((data) => {
      writeToPTY(sessionId, data).catch(() => {});
    });

    return () => onDataDisposer.dispose();
  }, [sessionId]);

  // Wire terminal resize → PTY resize (depends on sessionId)
  useEffect(() => {
    const term = terminalRef.current;
    if (!term || !sessionId) return;

    const resizeHandler = term.onResize(({ cols, rows }) => {
      resizePTY(sessionId, cols, rows).catch(() => {});
    });

    return () => resizeHandler.dispose();
  }, [sessionId]);

  const search = useCallback((query: string) => {
    searchAddonRef.current?.findNext(query);
  }, []);

  const clear = useCallback(() => {
    terminalRef.current?.clear();
  }, []);

  return {
    terminal: terminalRef,
    fitAddon: fitAddonRef,
    initTerminal,
    search,
    clear,
  };
}
