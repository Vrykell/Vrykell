import { create } from 'zustand';
import { safeJsonParse, safeLocalStorageGet, safeLocalStorageSet } from '@utils/errorHandler';
import { secondaryWorkspaceLabel } from '@platform/workspaceWindowIdentity';
import { emptyWorkbench, parseWorkbench, type WorkbenchSnapshot, type WorkspaceContainer } from '../model/workbench';

export const WORKBENCH_STORAGE_KEY = 'workspace-containers-v2';
export interface WorkbenchState {
  ready: boolean;
  lastClosed: WorkspaceContainer | null;
  snapshot: WorkbenchSnapshot;
  update: (apply: (state: WorkbenchSnapshot) => WorkbenchSnapshot) => void;
}

/** All scopes persist the same versioned reference-only snapshot. */
export function createWorkbenchStore(key: string | null = WORKBENCH_STORAGE_KEY, ready = true) {
  const saved = key ? safeJsonParse<unknown>(safeLocalStorageGet(key) ?? 'null') : null;
  const store = create<WorkbenchState>((set) => ({
    snapshot: parseWorkbench(saved) ?? emptyWorkbench(),
    ready,
    lastClosed: null,
    update: (apply) =>
      set((state) => {
        const snapshot = apply(state.snapshot);
        return snapshot === state.snapshot ? state : { snapshot };
      }),
  }));
  store.subscribe((state, previous) => {
    if (key && state.ready && (state.snapshot !== previous.snapshot || state.ready !== previous.ready))
      safeLocalStorageSet(key, JSON.stringify(state.snapshot));
  });
  return store;
}

export const useWorkbenchStore = createWorkbenchStore(secondaryWorkspaceLabel() ? null : WORKBENCH_STORAGE_KEY, false);
