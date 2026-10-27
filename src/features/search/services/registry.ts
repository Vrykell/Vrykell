import { create } from 'zustand';
import type { SearchSource, ResultType } from '@features/search/types';

const sources = new Map<ResultType, SearchSource>();

/** Registers a search source (each source file calls this on import) */
export function registerSource(source: SearchSource) {
  if (!sources.has(source.id)) {
    sources.set(source.id, source);
  }
}

export function getSources(): SearchSource[] {
  return Array.from(sources.values());
}

export function getSource(id: ResultType): SearchSource | undefined {
  return sources.get(id);
}

export function getSourceIds(): ResultType[] {
  return Array.from(sources.keys());
}

// ── Filter — set of enabled source IDs (store, so results/UI refresh reactively after a toggle) ──

const DEFAULT_ENABLED: ResultType[] = ['history', 'block', 'file', 'setting', 'action', 'session'];

interface EnabledSourcesState {
  enabledIds: Set<ResultType>;
  toggle: (id: ResultType, enabled: boolean) => void;
  setAll: (ids: Set<ResultType>) => void;
}

export const useEnabledSourcesStore = create<EnabledSourcesState>((set, get) => ({
  enabledIds: new Set(DEFAULT_ENABLED),
  toggle: (id, enabled) => {
    const next = new Set(get().enabledIds);
    if (enabled) next.add(id);
    else next.delete(id);
    set({ enabledIds: next });
  },
  setAll: (ids) => set({ enabledIds: ids }),
}));

/** Returns the enabled source IDs (non-reactive, for non-component code such as the engine) */
export function getEnabledSourceIds(): Set<ResultType> {
  return useEnabledSourcesStore.getState().enabledIds;
}

/** Toggles a source's enabled state (synchronous wrapper kept for backward compatibility) */
export function toggleSource(id: ResultType, enabled: boolean) {
  useEnabledSourcesStore.getState().toggle(id, enabled);
}
