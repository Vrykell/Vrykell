import { create } from 'zustand';
import { safeJsonParse, safeLocalStorageGet, safeLocalStorageSet } from '@utils/errorHandler';
import { orderedWorkspaceIds } from './navigation';
import { mapWorkspacePane, parseWorkspacePaneLayout, pruneWorkspacePanes, splitWorkspacePane, workspacePaneCells, type WorkspacePaneLayout } from '../model/workspaceResources';

const STORAGE_KEY = 'unified-workspace-v1';
const saved = safeJsonParse<{ layout?: unknown; order?: unknown; focused?: unknown }>(safeLocalStorageGet(STORAGE_KEY) ?? '{}');
let sequence = 0;
const pane = (resourceId: string): Extract<WorkspacePaneLayout, { type: 'pane' }> => ({ type: 'pane', id: `pane-${Date.now()}-${sequence++}`, resourceId });

interface UnifiedWorkspaceState {
  layout: WorkspacePaneLayout | null; focused: string; order: string[];
  reconcile: (ids: string[]) => void;
  show: (id: string) => void;
  split: (id: string, direction: 'row' | 'col') => void;
  removePane: (id: string) => void;
  single: () => void;
  move: (ids: string[], id: string, over: string, after: boolean) => void;
  ratio: (firstId: string, secondId: string, ratio: number) => void;
}

export const useUnifiedWorkspace = create<UnifiedWorkspaceState>((set) => ({
  layout: parseWorkspacePaneLayout(saved?.layout), focused: typeof saved?.focused === 'string' ? saved.focused : '',
  order: Array.isArray(saved?.order) ? saved.order.filter((id): id is string => typeof id === 'string') : [],
  reconcile: ids => set(state => {
    let layout = pruneWorkspacePanes(state.layout, new Set(ids));
    if (!layout && ids[0]) layout = pane(ids[0]);
    const cells = layout ? workspacePaneCells(layout) : [];
    const focused = cells.some(cell => cell.id === state.focused) ? state.focused : cells[0]?.id ?? '';
    const order = orderedWorkspaceIds(ids, state.order);
    if (JSON.stringify(layout) === JSON.stringify(state.layout) && focused === state.focused && JSON.stringify(order) === JSON.stringify(state.order)) return state;
    return { layout, focused, order };
  }),
  show: id => set(state => {
    const existing = state.layout && workspacePaneCells(state.layout).find(cell => cell.resourceId === id);
    if (existing) return { focused: existing.id };
    if (!state.layout) { const next = pane(id); return { layout: next, focused: next.id }; }
    return { layout: mapWorkspacePane(state.layout, state.focused, node => node.type === 'pane' ? { ...node, resourceId: id } : node) };
  }),
  split: (id, direction) => set(state => {
    if (!state.layout) { const next = pane(id); return { layout: next, focused: next.id }; }
    const next = pane(id); const layout = splitWorkspacePane(state.layout, state.focused, next, direction);
    return layout === state.layout ? state : { layout, focused: next.id };
  }),
  removePane: id => set(state => {
    if (!state.layout) return state;
    const cells = workspacePaneCells(state.layout).filter(cell => cell.id !== id);
    const layout = pruneWorkspacePanes(state.layout, new Set(cells.map(cell => cell.resourceId)));
    return { layout, focused: cells.some(cell => cell.id === state.focused) ? state.focused : cells[0]?.id ?? '' };
  }),
  single: () => set(state => {
    const current = state.layout && workspacePaneCells(state.layout).find(cell => cell.id === state.focused);
    return current ? { layout: { type: 'pane', id: current.id, resourceId: current.resourceId } } : state;
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
useUnifiedWorkspace.subscribe(state => safeLocalStorageSet(STORAGE_KEY, JSON.stringify({ version: 1, layout: state.layout, focused: state.focused, order: state.order })));
