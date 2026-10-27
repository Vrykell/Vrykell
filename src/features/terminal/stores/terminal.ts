import { create } from 'zustand';
import { terminalCommandPayload, writeTerminalCommand } from '../services/commandSubmission';
import { writeTerminalInput } from '../services/terminalWriteQueue';
import { useWorkspaceStore, isSessionTab } from '@features/workspace/stores/workspace';
import { leaves as layoutLeaves, firstLeaf } from '@features/workspace/model/windowLayout';
import { terminalDebug } from '@features/terminal/services/terminalDebug';
import { useInputStore } from './input';
import { applyTerminalRenderer } from '@features/terminal/model/xtermRenderer';
import { useTypographyStore } from '@config/typography';
import type { Terminal } from '@xterm/xterm';
import type { Scene } from '@features/terminal/services/pipeline/sessionController';

// One terminal emulator instance per tab (module-level reference, kept out of store state)
const termInstances = new Map<string, Terminal>();
export { termInstances };

// Apply renderer preference changes to open terminals immediately (new terminals read the same preference when mounting).
useTypographyStore.subscribe((state, previous) => {
  if (state.terminalRenderer === previous.terminalRenderer) return;
  for (const term of termInstances.values()) applyTerminalRenderer(term, state.terminalRenderer);
});

// e2e test bridge: exposes the terminal registry so assertions can read the buffer (with
// the GPU renderer, text never enters the DOM, so text queries cannot read terminal output).
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__vrykellTerms = termInstances;
}

export function registerTerminal(tabId: string, t: Terminal) {
  termInstances.set(tabId, t);
}
export function unregisterTerminal(tabId: string, t: Terminal) {
  if (termInstances.get(tabId) === t) termInstances.delete(tabId);
}

/** Focused terminal id: prefer focusedPaneId when it belongs to the active window, otherwise the active window's first terminal. */
export function getFocusedTerminalId(): string {
  const ts = useTerminalStore.getState();
  const ws = useWorkspaceStore.getState();
  const tab = ws.tabs.find((t) => t.id === ws.activeId);
  if (tab && isSessionTab(tab)) {
    const ids = layoutLeaves(tab.layout);
    if (ts.focusedPaneId && ts.sessions[ts.focusedPaneId] && ids.some((t) => t.id === ts.focusedPaneId)) {
      return ts.focusedPaneId;
    }
    return firstLeaf(tab.layout).id;
  }
  return ws.activeId;
}

/** Read the last maxLines of a pane's terminal buffer (trailing blank lines removed) for sending output to the AI. */
export function getRecentOutputFor(paneId: string, maxLines = 30): string {
  const term = termInstances.get(paneId);
  if (!term) return '';
  const buf = term.buffer.active;
  const end = buf.baseY + buf.cursorY;
  const start = Math.max(0, end - maxLines + 1);
  const lines: string[] = [];
  for (let i = start; i <= end; i++) {
    const line = buf.getLine(i);
    if (line) lines.push(line.translateToString(true));
  }
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') lines.pop();
  return lines.join('\n');
}

/** Read the last maxLines of the focused terminal buffer (trailing blank lines removed) for sending output to the AI. */
export function getRecentOutput(maxLines = 30): string {
  return getRecentOutputFor(getFocusedTerminalId(), maxLines);
}

/** Live terminal screen (used by the read_terminal tool). */
export interface TerminalScreen {
  scene: Scene;
  cols: number;
  rows: number;
  /** Cursor position within the visible screen (0-based row, column); null in block-list and other cursorless scenes */
  cursorY: number | null;
  cursorX: number | null;
  /** Visible screen text (with line numbers, trailing blank lines removed) */
  content: string;
}

/**
 * Read the current visible screen of a pane's main terminal (classic / altScreen scenes).
 * Coverage is the current viewport (the whole screen in the alt buffer; the visible viewport
 * in the normal buffer). Returns null when no terminal instance exists (for example while the
 * main terminal is idle or unmounted in blockList), leaving fallback to the caller.
 */
export function getTerminalScreen(paneId: string): TerminalScreen | null {
  const ts = useTerminalStore.getState();
  const scene = ts.scenes[paneId] ?? 'classic';
  const dims = ts.dims[paneId] ?? { cols: 80, rows: 24 };
  const term = ts.manualFullscreen[paneId] ? termInstances.get(`block:${paneId}`) ?? termInstances.get(paneId) : termInstances.get(paneId);
  if (!term) return null;
  const buf = term.buffer.active;
  const cols = term.cols || dims.cols;
  const rows = term.rows || dims.rows;
  // viewportY = absolute buffer row of the visible top; the alt buffer has no scrollback, so it stays 0
  const start = Math.max(0, buf.viewportY);
  const end = Math.min(buf.length - 1, start + rows - 1);
  const lines: string[] = [];
  for (let i = start; i <= end; i++) {
    const line = buf.getLine(i);
    lines.push(line ? line.translateToString(true) : '');
  }
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') lines.pop();
  const content = lines
    .map((l, i) => `${String(i + 1).padStart(2, ' ')}│${l}`)
    .join('\n');
  return {
    scene,
    cols,
    rows,
    cursorY: buf.cursorY,
    cursorX: buf.cursorX,
    content,
  };
}

interface TerminalState {
  /** tabId → PTY session id */
  sessions: Record<string, string>;
  /** Shell startup is separate from PTY allocation. */
  startupStates: Record<string, 'starting' | 'ready' | 'failed' | 'closed'>;
  setStartupState: (paneId: string, status: 'starting' | 'ready' | 'failed' | 'closed') => void;
  /** Commands buffered until the session exists; setSession flushes them verbatim once the PTY is ready */
  pendingCommands: Record<string, string[]>;
  /** tabId → terminal dimensions (shown in the status bar) */
  dims: Record<string, { cols: number; rows: number }>;
  visible: boolean;
  /** Manual fullscreen belongs to its pane, independently of the controller's alternate buffer. */
  manualFullscreen: Record<string, boolean>;
  setManualFullscreen: (paneId: string, active: boolean) => void;
  /** Keyboard routing target: 'input' → InputEditor, 'terminal' → the terminal emulator */
  keyboardTarget: 'input' | 'terminal';
  setKeyboardTarget: (t: 'input' | 'terminal') => void;
  /** Focused paneId in a split (decides which PTY receives keyboard input and runInTerminal writes) */
  focusedPaneId: string | null;
  setFocusedPane: (paneId: string | null) => void;
  /** tabId → current scene state machine (classic / blockList / altScreen) */
  scenes: Record<string, Scene>;
  /** Actual local shell selected when each live process started. */
  shellTypes: Record<string, string>;
  setScene: (tabId: string, scene: Scene) => void;
  setSession: (tabId: string, sessionId: string) => void;
  /** Clear a stopped session without discarding its scene, dimensions or history. */
  clearSession: (tabId: string, expectedSessionId?: string) => void;
  queueCommand: (tabId: string, command: string) => void;
  setDims: (tabId: string, cols: number, rows: number) => void;
  /** Remove the tab's session/dims/scene when the tab closes, leaving no per-tab residue */
  dropTab: (tabId: string) => void;
  toggle: () => void;
  stageCommand: (paneId: string, command: string) => void;
  runInTerminal: (command: string, paneId?: string) => Promise<void>;
  /** External write into the composer (for example a clicked history entry); InputEditor clears it after consuming */
  pendingInput: string;
  setPendingInput: (text: string) => void;
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  sessions: {},
  shellTypes: {},
  startupStates: {},
  setStartupState: (paneId, status) => set(s => ({ startupStates: { ...s.startupStates, [paneId]: status } })),
  pendingCommands: {},
  dims: {},
  visible: true,
  manualFullscreen: {},
  scenes: {} as Record<string, Scene>,
  setManualFullscreen: (paneId, active) => set(state => {
    if (!!state.manualFullscreen[paneId] === active) return state;
    const manualFullscreen = { ...state.manualFullscreen };
    if (active) manualFullscreen[paneId] = true; else delete manualFullscreen[paneId];
    terminalDebug('manual-fullscreen-state', { paneId, active });
    return { manualFullscreen };
  }),
  keyboardTarget: 'input',
  setKeyboardTarget: (t) => set({ keyboardTarget: t }),
  focusedPaneId: null,
  setFocusedPane: (paneId) => set({ focusedPaneId: paneId }),
  setScene: (tabId, scene) =>
    set((s) => ({ scenes: { ...s.scenes, [tabId]: scene } })),
  setSession: (tabId, sessionId) => {
    const queued = get().pendingCommands[tabId] ?? [];
    set((s) => {
      const pendingCommands = { ...s.pendingCommands };
      delete pendingCommands[tabId];
      return {
        sessions: { ...s.sessions, [tabId]: sessionId },
        pendingCommands,
      };
    });
    if (queued.length > 0) {
      const data = queued
        .map(command => terminalCommandPayload(tabId, command))
        .join('');
      terminalDebug('queued-command-flush', { tabId, sessionId, count: queued.length, chars: data.length });
      writeTerminalInput(sessionId, data)
        .then(() => terminalDebug('queued-command-write-complete', { tabId, sessionId, chars: data.length }))
        .catch((error) => terminalDebug('queued-command-write-error', {
          tabId,
          sessionId,
          errorType: error instanceof Error ? error.name : typeof error,
        }));
    }
  },
  clearSession: (tabId, expectedSessionId) => set((s) => {
    if (expectedSessionId && s.sessions[tabId] !== expectedSessionId) return s;
    const sessions = { ...s.sessions };
    const shellTypes = { ...s.shellTypes };
    const pendingCommands = { ...s.pendingCommands };
    delete sessions[tabId];
    delete shellTypes[tabId];
    delete pendingCommands[tabId];
    return { sessions, shellTypes, pendingCommands, startupStates: { ...s.startupStates, [tabId]: 'closed' } };
  }),
  queueCommand: (tabId, command) => {
    const sessionId = get().sessions[tabId];
    if (sessionId) {
      writeTerminalCommand(tabId, sessionId, command).catch(() => {});
      return;
    }
    if (!command.trim()) return;
    terminalDebug('command-queued', { tabId, commandChars: command.length });
    set((s) => ({
      pendingCommands: {
        ...s.pendingCommands,
        [tabId]: [...(s.pendingCommands[tabId] ?? []), command],
      },
    }));
  },
  setDims: (tabId, cols, rows) =>
    set((s) => s.dims[tabId]?.cols === cols && s.dims[tabId]?.rows === rows ? s : { dims: { ...s.dims, [tabId]: { cols, rows } } }),
  dropTab: (tabId) =>
    set((s) => {
      if (
        !(tabId in s.sessions)
        && !(tabId in s.pendingCommands)
        && !(tabId in s.dims)
        && !(tabId in s.scenes)
        && !(tabId in s.startupStates)
        && !(tabId in s.manualFullscreen)
        && !(tabId in s.shellTypes)
      ) return s;
      const sessions = { ...s.sessions };
      const shellTypes = { ...s.shellTypes };
      const pendingCommands = { ...s.pendingCommands };
      const dims = { ...s.dims };
      const scenes = { ...s.scenes };
      const startupStates = { ...s.startupStates };
      const manualFullscreen = { ...s.manualFullscreen };
      delete sessions[tabId];
      delete shellTypes[tabId];
      delete pendingCommands[tabId];
      delete dims[tabId];
      delete scenes[tabId];
      delete startupStates[tabId];
      delete manualFullscreen[tabId];
      return { sessions, shellTypes, pendingCommands, dims, scenes, startupStates, manualFullscreen };
    }),
  toggle: () => set((s) => ({ visible: !s.visible })),
  stageCommand: (paneId, command) => {
    const workspace = useWorkspaceStore.getState();
    const owner = workspace.tabs.find(tab => isSessionTab(tab) && layoutLeaves(tab.layout).some(pane => pane.id === paneId));
    if (owner && owner.id !== workspace.activeId) workspace.activate(owner.id);
    set({ visible: true, focusedPaneId: paneId, keyboardTarget: 'input' });
    useInputStore.getState().stageText(paneId, command.replace(/\r\n|\r/g, '\n'));
    terminalDebug('terminal-script-staged', { paneId, chars: command.length });
  },
  runInTerminal: async (command, paneId) => {
    const target = paneId ?? getFocusedTerminalId();
    const text = command.trim();
    if (!text) return;
    if (/[\r\n]/.test(text)) {
      get().stageCommand(target, text);
      return;
    }
    const sessionId = get().sessions[target];
    set({ visible: true });
    if (!sessionId) return;
    await writeTerminalCommand(target, sessionId, text);
  },
  pendingInput: '',
  setPendingInput: (text) => set({ pendingInput: text }),
}));
