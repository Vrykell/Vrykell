import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { isHistoryGroupColor, type HistoryGroupColor } from '@ui/historyGroupColor';

export type IconColors = Record<string, HistoryGroupColor>;

/** Stable entity keys keep colors across navigation, archive and restoration. */
export const iconColorKey = (scope: 'session' | 'page', id: string) => `${scope}:${id}`;

export function iconColorCss(color: HistoryGroupColor | null | undefined): string | undefined {
  return color ? color === 'neutral' ? 'var(--text-secondary)' : `var(--group-${color})` : undefined;
}

function sanitizeColors(value: unknown): IconColors {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const colors: IconColors = {};
  for (const [key, color] of Object.entries(value)) {
    if (/^(session|page):.+/.test(key) && isHistoryGroupColor(color)) colors[key] = color;
  }
  return colors;
}

interface IconColorState {
  colors: IconColors;
  setColor: (key: string, color: HistoryGroupColor | null) => void;
}

export const useIconColorStore = create<IconColorState>()(persist((set) => ({
  colors: {},
  setColor: (key, color) => set(state => {
    const colors = { ...state.colors };
    if (color && isHistoryGroupColor(color)) colors[key] = color;
    else delete colors[key];
    return { colors };
  }),
}), {
  name: 'vrykell-icon-colors',
  partialize: state => ({ colors: state.colors }),
  merge: (saved, current) => ({ ...current, colors: sanitizeColors((saved as Partial<IconColorState> | undefined)?.colors) }),
}));
