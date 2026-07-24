// Public entry point for the terminal feature.
// Engine (pure VT model, no React) and UI (React components + hooks).

export { TerminalBuffer } from './engine/buffer';
export type { Cell, TerminalLine } from './engine/buffer';
export { getCharWidth } from './engine/char-width';

export { TerminalView, DomTerminalView } from './ui/TerminalView';
export { TerminalTabs } from './ui/TerminalTabs';
export { useTerminal } from './ui/hooks/useTerminal';
