import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const DEFAULT_UI_FONT_SIZE = 13;
export const DEFAULT_TERMINAL_FONT_SIZE = 14;
export const DEFAULT_CHAT_FONT_SIZE = 14;
export const DEFAULT_TERMINAL_FONT_WEIGHT = 400;
export const DEFAULT_TERMINAL_LINE_HEIGHT = 1;
export const TERMINAL_FONT_PRESETS = ['system', 'Sarasa Term SC', 'Sarasa Mono SC', 'Maple Mono NF CN', 'Maple Mono', 'Cascadia Code', 'JetBrains Mono', 'NSimSun'] as const;
export type TerminalFontPreset = typeof TERMINAL_FONT_PRESETS[number];
const fallbackFonts = '"Cascadia Mono", "Cascadia Code", Menlo, Monaco, "JetBrains Mono", "Sarasa Mono SC", "Noto Sans Mono CJK SC", "Noto Sans Mono", "DejaVu Sans Mono", "Symbols Nerd Font Mono", monospace, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji"';

export function terminalFontFamily(preset: TerminalFontPreset): string {
  return preset === 'system' ? fallbackFonts : `"${preset}", ${fallbackFonts}`;
}

function boundedFontPreset(value: unknown): TerminalFontPreset {
  return TERMINAL_FONT_PRESETS.find(preset => preset === value) ?? 'system';
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

export function boundedFontSize(value: unknown, fallback: number, max = 24): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(10, Math.min(max, Math.round(value))) : fallback;
}

/** Terminal renderer choice: WebGL joins half blocks, DOM keeps cleaner edges. */
export type TerminalRenderer = 'webgl' | 'dom';
export const DEFAULT_TERMINAL_RENDERER: TerminalRenderer = 'webgl';

export function boundedTerminalRenderer(value: unknown, fallback: TerminalRenderer): TerminalRenderer {
  return value === 'webgl' || value === 'dom' ? value : fallback;
}

interface TypographyState {
  uiFontSize: number;
  terminalFontSize: number;
  chatFontSize: number;
  editorFontSize: number;
  editorFontPreset: TerminalFontPreset;
  editorFontWeight: number;
  editorLineHeight: number;
  terminalRenderer: TerminalRenderer;
  terminalFontPreset: TerminalFontPreset;
  terminalFontWeight: number;
  terminalLineHeight: number;
  commandHighlighting: boolean;
  commandTitleCollapsed: boolean;
  terminalCursorBlink: boolean;
  compositionCursorBlink: boolean;
  update: (patch: Partial<TypographyPreferences>) => void;
  reset: () => void;
}

type TypographyPreferences = Omit<TypographyState, 'update' | 'reset'>;
const defaults: TypographyPreferences = {
  uiFontSize: DEFAULT_UI_FONT_SIZE,
  terminalFontSize: DEFAULT_TERMINAL_FONT_SIZE,
  chatFontSize: DEFAULT_CHAT_FONT_SIZE,
  editorFontSize: 13,
  editorFontPreset: 'system',
  editorFontWeight: 400,
  editorLineHeight: 1.5,
  terminalRenderer: DEFAULT_TERMINAL_RENDERER,
  terminalFontPreset: 'system',
  terminalFontWeight: DEFAULT_TERMINAL_FONT_WEIGHT,
  terminalLineHeight: DEFAULT_TERMINAL_LINE_HEIGHT,
  commandHighlighting: false,
  commandTitleCollapsed: false,
  terminalCursorBlink: false,
  compositionCursorBlink: false,
};

function sanitize(values: Partial<TypographyPreferences>): TypographyPreferences {
  return {
    uiFontSize: boundedFontSize(values.uiFontSize, DEFAULT_UI_FONT_SIZE, 18),
    terminalFontSize: boundedFontSize(values.terminalFontSize, DEFAULT_TERMINAL_FONT_SIZE),
    chatFontSize: boundedFontSize(values.chatFontSize, DEFAULT_CHAT_FONT_SIZE),
    editorFontSize: boundedFontSize(values.editorFontSize, 13),
    editorFontPreset: boundedFontPreset(values.editorFontPreset),
    editorFontWeight: Math.round(boundedNumber(values.editorFontWeight, 400, 100, 900)),
    editorLineHeight: boundedNumber(values.editorLineHeight, 1.5, 1, 2),
    terminalRenderer: boundedTerminalRenderer(values.terminalRenderer, DEFAULT_TERMINAL_RENDERER),
    terminalFontPreset: boundedFontPreset(values.terminalFontPreset),
    terminalFontWeight: Math.round(boundedNumber(values.terminalFontWeight, DEFAULT_TERMINAL_FONT_WEIGHT, 100, 900)),
    terminalLineHeight: boundedNumber(values.terminalLineHeight, DEFAULT_TERMINAL_LINE_HEIGHT, 1, 1.6),
    commandHighlighting: values.commandHighlighting === true,
    commandTitleCollapsed: values.commandTitleCollapsed === true,
    terminalCursorBlink: values.terminalCursorBlink === true,
    compositionCursorBlink: values.compositionCursorBlink === true,
  };
}

export function terminalTypographyChanged(state: TypographyPreferences, previous: TypographyPreferences): boolean {
  return state.terminalFontSize !== previous.terminalFontSize || state.terminalFontPreset !== previous.terminalFontPreset
    || state.terminalFontWeight !== previous.terminalFontWeight || state.terminalLineHeight !== previous.terminalLineHeight;
}

export const useTypographyStore = create<TypographyState>()(persist((set) => ({
  ...defaults,
  update: patch => set(state => sanitize({ ...state, ...patch })),
  reset: () => set(state => ({ ...defaults, commandHighlighting: state.commandHighlighting, commandTitleCollapsed: state.commandTitleCollapsed })),
}), {
  name: 'vrykell-typography',
  merge: (saved, current) => {
    const values = saved as Partial<TypographyState> | undefined;
    return { ...current, ...sanitize(values ?? {}) };
  },
}));

function applyTypography(state: TypographyState): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement.style;
  root.setProperty('--ui-font-scale', String(state.uiFontSize / DEFAULT_UI_FONT_SIZE));
  root.setProperty('--terminal-font-size', `${state.terminalFontSize}px`);
  root.setProperty('--chat-font-size', `${state.chatFontSize}px`);
  root.setProperty('--chat-font-scale', String(state.chatFontSize / DEFAULT_CHAT_FONT_SIZE));
  root.setProperty('--editor-font-family', terminalFontFamily(state.editorFontPreset));
  root.setProperty('--editor-font-size', `${state.editorFontSize}px`);
  root.setProperty('--editor-font-weight', String(state.editorFontWeight));
  root.setProperty('--editor-line-height', String(state.editorLineHeight));
  root.setProperty('--terminal-font-family', terminalFontFamily(state.terminalFontPreset));
  root.setProperty('--terminal-font-weight', String(state.terminalFontWeight));
  root.setProperty('--terminal-bold-weight', String(Math.max(700, state.terminalFontWeight)));
  root.setProperty('--terminal-input-row-height', `${Math.ceil(Math.max(22, state.terminalFontSize * 16 / 14) * state.terminalLineHeight)}px`);
  root.setProperty('--terminal-command-weight', String(Math.min(900, state.terminalFontWeight + 100)));
  root.setProperty('--terminal-ime-cursor-animation', state.compositionCursorBlink ? 'cursor-blink 1s step-end infinite' : 'none');
  // `--terminal-row-height` is the terminal cell height: it belongs to the resolved font, so the
  // terminal layer measures it (see features/terminal/model/terminalFont.ts) instead of deriving
  // it here, where only the font size is known.
}

applyTypography(useTypographyStore.getState());
useTypographyStore.subscribe(applyTypography);
