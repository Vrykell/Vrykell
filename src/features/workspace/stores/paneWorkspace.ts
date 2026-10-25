import { create } from 'zustand';
import { safeJsonParse, safeLocalStorageGet, safeLocalStorageSet } from '@utils/errorHandler';
import { orderedWorkspaceIds } from './navigation';
import { mapWorkspacePane, parseWorkspacePaneLayout, pruneWorkspacePanes, splitWorkspacePane, workspacePaneCells, type WorkspacePaneLayout } from '../model/workspaceResources';
import type { PaneTarget } from '@core/paneLayout';
import type { TerminalSpec } from '../model/windowLayout';
import type { WorkspaceHistoryIdentity } from '../model/workspaceHistory';

let sequence = 0;
const pane = (resourceId: string): Extract<WorkspacePaneLayout, { type: 'pane' }> => ({ type: 'pane', id: `pane-${Date.now()}-${sequence++}`, resourceId });

export interface PaneWorkspaceState {
  activeTabId: string;
  zoomed: string | null;
  layout: WorkspacePaneLayout | null; focused: string; order: string[];
  startOpen: boolean; startActive: boolean; choosingSplit: boolean;
  splitAnchor?: { x: number; y: number };
  pendingTerminalSplit?: TerminalSpec;
  historyIdentity?: WorkspaceHistoryIdentity;
  openStart: () => void; closeStart: () => void;
  reconcile: (ids: string[]) => void;
  show: (id: string) => void;
  split: (id: string, direction: 'row' | 'col') => void;
  place: (id: string, target: PaneTarget) => void;
  removePane: (id: string) => void;
  single: () => void;
  move: (ids: string[], id: string, over: string, after: boolean) => void;
  ratio: (firstId: string, secondId: string, ratio: number) => void;
  restore: (layout: WorkspacePaneLayout, focused: string, identity?: WorkspaceHistoryIdentity) => void;
}

export function createPaneWorkspaceStore(storageKey: string, persist = true) {
  const saved = safeJsonParse<{ layout?: unknown; order?: unknown; focused?: unknown; historyIdentity?: WorkspaceHistoryIdentity }>(safeLocalStorageGet(storageKey) ?? '{}');
  const store = create<PaneWorkspaceState>((set) => ({
    activeTabId: '', zoomed: null,
    startOpen: true, startActive: true, choosingSplit: false,
    restore: (layout, focused, historyIdentity) => {
      const parsed = parseWorkspacePaneLayout(layout);
      if (!parsed) return;
      const cells = workspacePaneCells(parsed);
      set({ layout: parsed, focused: cells.some(cell => cell.id === focused) ? focused : cells[0]!.id, startActive: false, historyIdentity });
    },
    openStart: () => set({ startOpen: true, startActive: true }),
    closeStart: () => set(state => state.layout ? { startOpen: false, startActive: false } : state),
    layout: parseWorkspacePaneLayout(saved?.layout), focused: typeof saved?.focused === 'string' ? saved.focused : '',
    historyIdentity: saved?.historyIdentity?.id?.startsWith('workspace:') && Number.isFinite(saved.historyIdentity.createdAt) ? saved.historyIdentity : undefined,
    order: Array.isArray(saved?.order) ? saved.order.filter((id): id is string => typeof id === 'string') : [],
    reconcile: ids => set(state => {
      let layout = pruneWorkspacePanes(state.layout, new Set(ids));
      if (!layout && ids[0]) layout = pane(ids[0]);
      const cells = layout ? workspacePaneCells(layout) : [];
      const focused = cells.some(cell => cell.id === state.focused) ? state.focused : cells[0]?.id ?? '';
      const order = orderedWorkspaceIds(ids, state.order);
      const startActive = !layout || state.startActive; const startOpen = !layout || state.startOpen;
      if (JSON.stringify(layout) === JSON.stringify(state.layout) && focused === state.focused && JSON.stringify(order) === JSON.stringify(state.order) && startActive === state.startActive && startOpen === state.startOpen) return state;
      return { layout, focused, order, startActive, startOpen, ...(layout !== state.layout ? { historyIdentity: undefined } : {}) };
    }),
    show: id => set(state => {
      const existing = state.layout && workspacePaneCells(state.layout).find(cell => cell.resourceId === id);
      if (existing) return { focused: existing.id, startActive: false };
      if (!state.layout) { const next = pane(id); return { layout: next, focused: next.id, startActive: false }; }
      return { layout: mapWorkspacePane(state.layout, state.focused, node => node.type === 'pane' ? { ...node, resourceId: id } : node), startActive: false, historyIdentity: undefined };
    }),
    split: (id, direction) => set(state => {
      if (!state.layout) { const next = pane(id); return { layout: next, focused: next.id }; }
      const next = pane(id); const layout = splitWorkspacePane(state.layout, state.focused, next, direction);
      return layout === state.layout ? state : { layout, focused: next.id, historyIdentity: undefined };
    }),
    place: (id, target) => set(state => {
      if (!state.layout) return state;
      const next = pane(id); const layout = splitWorkspacePane(state.layout, target.leafId, next, target.dir, target.position);
      return layout === state.layout ? state : { layout, focused: next.id, startActive: false, historyIdentity: undefined };
    }),
    removePane: id => set(state => {
      if (!state.layout || workspacePaneCells(state.layout).length < 2) return state;
      const cells = workspacePaneCells(state.layout).filter(cell => cell.id !== id);
      const layout = pruneWorkspacePanes(state.layout, new Set(cells.map(cell => cell.resourceId)));
      return { layout, focused: cells.some(cell => cell.id === state.focused) ? state.focused : cells[0]?.id ?? '', historyIdentity: undefined, ...(!layout ? { startOpen: true, startActive: true } : {}) };
    }),
    single: () => set(state => {
      const current = state.layout && workspacePaneCells(state.layout).find(cell => cell.id === state.focused);
      return current ? { layout: { type: 'pane', id: current.id, resourceId: current.resourceId }, historyIdentity: undefined } : state;
    }),
    move: (ids, id, over, after) => set(state => {
      const order = orderedWorkspaceIds(ids, state.order).filter(item => item !== id); const index = order.indexOf(over);
      if (!ids.includes(id) || id === over || index < 0) return state;
      order.splice(index + (after ? 1 : 0), 0, id); return { order };
    }),
    ratio: (firstId, secondId, ratio) => set(state => {
      const update = (node: WorkspacePaneLayout): WorkspacePaneLayout => node.type === 'pane' ? node : {
        ...node, ratio: workspacePaneCells(node.first)[0]?.id === firstId && workspacePaneCells(node.second)[0]?.id === secondId ? Math.max(0.2, Math.min(0.8, ratio)) : node.ratio,
        first: update(node.first), second: update(node.second),
      };
      return state.layout ? { layout: update(state.layout) } : state;
    }),
  }));
  if (persist) store.subscribe(state => safeLocalStorageSet(storageKey, JSON.stringify({ version: 1, layout: state.layout, focused: state.focused, order: state.order, historyIdentity: state.historyIdentity })));
  return store;
}
