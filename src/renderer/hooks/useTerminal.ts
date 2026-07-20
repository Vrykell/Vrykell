import { useEffect, useRef, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { WebglAddon } from '@xterm/addon-webgl';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { useTerminalStore } from '../stores/terminal-store';

interface UseTerminalOptions {
  containerRef: React.RefObject<HTMLDivElement | null>;
  sessionId: string | null;
}

export function useTerminal({ containerRef, sessionId }: UseTerminalOptions) {
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const disposersRef = useRef<Array<() => void>>([]);
  // Extract only terminal-relevant settings to avoid unnecessary
  // terminal recreation when non-terminal settings change
  const terminalSettings = useTerminalStore((s) => s.settings.terminal);

  // Initialize xterm.js instance (runs once per mount)
  const initTerminal = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    // Clean up previous instance
    if (terminalRef.current) {
      terminalRef.current.dispose();
    }
    container.innerHTML = '';

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

    // Try WebGL first, fall back to DOM renderer
    try {
      const webglAddon = new WebglAddon();
      term.loadAddon(webglAddon);
    } catch {
      // Plain DOM renderer as fallback (still performant for most cases)
      console.warn('WebGL not available, using DOM renderer');
    }

    term.open(container);
    fitAddon.fit();

    terminalRef.current = term;
    fitAddonRef.current = fitAddon;
    searchAddonRef.current = searchAddon;

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      term.dispose();
    };
  }, [containerRef, terminalSettings]);

  // Connect terminal input to PTY
  useEffect(() => {
    const term = terminalRef.current;
    if (!term || !sessionId) return;

    const onDataDisposer = term.onData((data) => {
      window.electronAPI?.writeToPTY(sessionId, data);
    });

    // Listen for PTY output
    const outputDisposer = window.electronAPI?.onPTYOutput(({ sessionId: sid, data }) => {
      if (sid === sessionId && terminalRef.current) {
        terminalRef.current.write(new Uint8Array(data));
      }
    });

    // Listen for exit
    const exitDisposer = window.electronAPI?.onPTYExit(({ sessionId: sid, exitCode }) => {
      if (sid === sessionId && terminalRef.current) {
        terminalRef.current.write(`\r\n\x1b[31m[Process exited with code: ${exitCode}]\x1b[0m\r\n`);
      }
    });

    return () => {
      onDataDisposer?.dispose();
      outputDisposer?.();
      exitDisposer?.();
    };
  }, [sessionId]);

  // Resize PTY when terminal resizes
  useEffect(() => {
    const term = terminalRef.current;
    if (!term || !sessionId) return;

    const resizeHandler = term.onResize(({ cols, rows }) => {
      window.electronAPI?.resizePTY(sessionId, cols, rows);
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
