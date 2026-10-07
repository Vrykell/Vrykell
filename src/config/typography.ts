import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const DEFAULT_UI_FONT_SIZE = 13;
export const DEFAULT_TERMINAL_FONT_SIZE = 14;

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
  terminalRenderer: TerminalRenderer;
  update: (patch: Partial<Pick<TypographyState, 'uiFontSize' | 'terminalFontSize' | 'terminalRenderer'>>) => void;
  reset: () => void;
}

export const useTypographyStore = create<TypographyState>()(persist((set) => ({
  uiFontSize: DEFAULT_UI_FONT_SIZE,
  terminalFontSize: DEFAULT_TERMINAL_FONT_SIZE,
  terminalRenderer: DEFAULT_TERMINAL_RENDERER,
  update: patch => set(state => ({
    uiFontSize: boundedFontSize(patch.uiFontSize ?? state.uiFontSize, DEFAULT_UI_FONT_SIZE, 18),
    terminalFontSize: boundedFontSize(patch.terminalFontSize ?? state.terminalFontSize, DEFAULT_TERMINAL_FONT_SIZE),
    terminalRenderer: boundedTerminalRenderer(patch.terminalRenderer ?? state.terminalRenderer, DEFAULT_TERMINAL_RENDERER),
  })),
  reset: () => set({
    uiFontSize: DEFAULT_UI_FONT_SIZE,
    terminalFontSize: DEFAULT_TERMINAL_FONT_SIZE,
    terminalRenderer: DEFAULT_TERMINAL_RENDERER,
  }),
}), {
  name: 'vrykell-typography',
  merge: (saved, current) => {
    const values = saved as Partial<TypographyState> | undefined;
    return { ...current,
      uiFontSize: boundedFontSize(values?.uiFontSize, DEFAULT_UI_FONT_SIZE, 18),
      terminalFontSize: boundedFontSize(values?.terminalFontSize, DEFAULT_TERMINAL_FONT_SIZE),
      terminalRenderer: boundedTerminalRenderer(values?.terminalRenderer, DEFAULT_TERMINAL_RENDERER),
    };
  },
}));

function applyTypography(state: TypographyState): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement.style;
  root.setProperty('--ui-font-scale', String(state.uiFontSize / DEFAULT_UI_FONT_SIZE));
  root.setProperty('--terminal-font-size', `${state.terminalFontSize}px`);
  root.setProperty('--terminal-row-height', `${Math.ceil(state.terminalFontSize * 16 / 14)}px`);
}

applyTypography(useTypographyStore.getState());
useTypographyStore.subscribe(applyTypography);
