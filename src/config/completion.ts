import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const COMPLETION_SHORTCUTS = ['ArrowRight', 'Tab', 'Shift+ArrowRight'] as const;
const defaults = ['ArrowRight', 'Tab'];

export interface CompletionKey {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

/** Modified character shortcuts leave plain typing and terminal navigation intact. */
export function completionShortcut(event: CompletionKey): string | undefined {
  if (event.ctrlKey || event.altKey || event.metaKey) {
    if (!/^[a-z0-9]$/i.test(event.key)) return undefined;
    return [event.ctrlKey && 'Control', event.altKey && 'Alt', event.metaKey && 'Meta', event.shiftKey && 'Shift', event.key.toUpperCase()].filter(Boolean).join('+');
  }
  if (event.key === 'ArrowRight') return event.shiftKey ? 'Shift+ArrowRight' : 'ArrowRight';
  if (event.key === 'Tab') return event.shiftKey ? 'Shift+Tab' : 'Tab';
  return undefined;
}

export function validCustomCompletionShortcut(value: unknown): value is string {
  return typeof value === 'string' && /^(?:Control\+)?(?:Alt\+)?(?:Meta\+)?(?:Shift\+)?[A-Z0-9]$/.test(value)
    && /^(Control|Alt|Meta)\+/.test(value);
}

interface CompletionPreferences {
  shortcuts: string[];
  customShortcut?: string;
  toggle: (shortcut: string) => void;
  setCustom: (shortcut: string) => void;
}

export const useCompletionPreferences = create<CompletionPreferences>()(persist(set => ({
  shortcuts: [...defaults],
  customShortcut: undefined,
  toggle: shortcut => set(state => {
    if (!COMPLETION_SHORTCUTS.some(key => key === shortcut) && shortcut !== state.customShortcut) return state;
    const shortcuts = state.shortcuts.includes(shortcut) ? state.shortcuts.filter(key => key !== shortcut) : [...state.shortcuts, shortcut];
    return shortcuts.length ? { shortcuts } : state;
  }),
  setCustom: shortcut => set(state => validCustomCompletionShortcut(shortcut)
    ? { customShortcut: shortcut, shortcuts: [...state.shortcuts.filter(key => key !== state.customShortcut), shortcut] }
    : state),
}), {
  name: 'vrykell-completion',
  merge: (saved, current) => {
    const values = saved as Partial<CompletionPreferences> | undefined;
    const customShortcut = validCustomCompletionShortcut(values?.customShortcut) ? values.customShortcut : undefined;
    const shortcuts = Array.isArray(values?.shortcuts) ? [...new Set(values.shortcuts.filter(key => typeof key === 'string' && (COMPLETION_SHORTCUTS.some(known => known === key) || key === customShortcut)))] : [];
    return { ...current, shortcuts: shortcuts.length ? shortcuts : [...defaults], customShortcut };
  },
}));

export function acceptsCompletionKey(event: CompletionKey, shortcuts: readonly string[], selectionStart: number, selectionEnd: number, textLength: number): boolean {
  const shortcut = completionShortcut(event);
  if (shortcut === 'Shift+Tab') return shortcuts.includes('Tab');
  if (!shortcut || !shortcuts.includes(shortcut)) return false;
  return !shortcut.endsWith('ArrowRight') || (selectionStart === textLength && selectionEnd === textLength);
}
