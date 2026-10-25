import { create } from 'zustand';
import { useHarnessStore } from './harness';
import { useComposerDrafts } from './composerDrafts';
import { terminalDebug } from '@features/terminal/services/terminalDebug';

export interface HarnessConnection { id: string; harness: string; cwd: string; fresh: boolean; resumeSessionId?: string }
interface HarnessWorkspaceState {
  connections: HarnessConnection[];
  selected: string;
  connect: (harness: string, cwd?: string, fresh?: boolean, resumeSessionId?: string) => string;
  select: (id: string) => void;
  close: (ids: string[]) => void;
  move: (id: string, over: string, after: boolean) => void;
}
let sequence = 0;

/** Workspace navigation is independent from each connection's protocol state. */
export const useHarnessWorkspace = create<HarnessWorkspaceState>((set, get) => ({
  connections: [], selected: '',
  connect: (harness, cwd = '', fresh = false, resumeSessionId) => {
    const existing = !fresh && get().connections.find(item => item.harness === harness && item.cwd === cwd && item.resumeSessionId === resumeSessionId);
    if (existing) { set({ selected: existing.id }); return existing.id; }
    const id = `harness-${Date.now()}-${sequence++}`;
    set(state => ({ connections: [...state.connections, { id, harness, cwd, fresh, ...(resumeSessionId ? { resumeSessionId } : {}) }], selected: id }));
    terminalDebug('harness-connection-added', { connectionId: id, hasDirectory: !!cwd });
    return id;
  },
  select: id => { if (get().connections.some(item => item.id === id)) set({ selected: id }); },
  close: ids => {
    const closed = new Set(ids);
    const index = get().connections.findIndex(item => item.id === get().selected);
    const connections = get().connections.filter(item => !closed.has(item.id));
    set({ connections, selected: closed.has(get().selected) ? connections[Math.min(index, connections.length - 1)]?.id ?? '' : get().selected });
    for (const id of ids) {
      useComposerDrafts.getState().dropTab(id);
      void useHarnessStore.getState().close(id);
    }
  },
  move: (id, over, after) => {
    const item = get().connections.find(entry => entry.id === id);
    if (!item || id === over) return;
    const connections = get().connections.filter(entry => entry.id !== id);
    const index = connections.findIndex(entry => entry.id === over);
    if (index < 0) return;
    connections.splice(index + (after ? 1 : 0), 0, item);
    set({ connections });
  },
}));
