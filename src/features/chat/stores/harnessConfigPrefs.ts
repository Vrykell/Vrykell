/**
 * harnessConfigPrefs — the session configuration last chosen for each harness.
 *
 * Agents own the live session state; this only carries the user's choices into the next new
 * session. Resumed sessions keep what the agent returns for them. Values are stored per harness
 * so switching to a different agent never leaks one agent's mode or model into another.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface HarnessConfigPreference {
  /** Values chosen from the agent's config options, keyed by option id. */
  config: Record<string, string | boolean>;
  /** A value chosen through the legacy mode API. */
  mode?: string;
  /** A value chosen through the legacy model API. */
  model?: string;
  /** Epoch milliseconds of the last change. */
  at: number;
}

interface HarnessConfigPrefs {
  prefs: Record<string, HarnessConfigPreference>;
  remember: (harness: string, update: { config?: Record<string, string | boolean>; mode?: string; model?: string }) => void;
}

export const useHarnessConfigPrefs = create<HarnessConfigPrefs>()(persist(
  (set) => ({
    prefs: {},
    remember: (harness, update) => set((state) => {
      const current = state.prefs[harness];
      return { prefs: { ...state.prefs, [harness]: {
        config: { ...(current?.config ?? {}), ...(update.config ?? {}) },
        mode: update.mode ?? current?.mode,
        model: update.model ?? current?.model,
        at: Date.now(),
      } } };
    }),
  }),
  { name: 'vrykell-harness-config', version: 1 },
));
