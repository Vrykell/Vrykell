import { create } from 'zustand';
import type { PaneTarget } from '@core/paneLayout';
import { parseWorkspacePaneLayout, pruneWorkspacePanes, setWorkspacePaneRatio, workspacePaneCells, type WorkspacePaneLayout } from '../model/workspaceResources';
import type { WorkspaceHistoryIdentity } from '../model/workspaceHistory';
import { acceptsWorkspaceResource, detachContainerPane, focusContainerResource, mergeContainers, moveContainer, panesOf, placeContainerResource, putContainer, reconcileContainers, releaseContainerResources, selectContainer, type WorkspaceContainer, type WorkspaceScope } from '../model/workbench';
import { createWorkbenchStore, useWorkbenchStore } from './workbench';

let sequence = 0;
export const newContainerId = () => `workspace-${crypto.randomUUID()}`;
const pane = (resourceId: string): Extract<WorkspacePaneLayout, { type: 'pane' }> => ({ type: 'pane', id: `pane-${Date.now()}-${sequence++}`, resourceId });

export interface PaneWorkspaceState {
  activeTabId: string;
  layout: WorkspacePaneLayout | null; focused: string;
  startActive: boolean; choosingSplit: boolean;
  splitAnchor?: { x: number; y: number };
  pendingMergeTab?: string;
  chooseMerge: (sourceId?: string) => void;
  historyIdentity?: WorkspaceHistoryIdentity;
  openStart: () => void;
  reconcile: (ids: string[]) => void; show: (id: string) => void;
  split: (id: string, direction: 'row' | 'col') => void;
  place: (id: string, target: PaneTarget) => void;
  removePane: (id: string) => void;
  move: (ids: string[], id: string, over: string, after: boolean) => void;
  ratio: (firstId: string, secondId: string, ratio: number) => void;
  restore: (layout: WorkspacePaneLayout, focused: string, identity?: WorkspaceHistoryIdentity) => void;
  selectTab: (id: string) => void;
  detach: (resourceId: string) => string | undefined;
  merge: (sourceId: string, target: PaneTarget) => void;
}

/** An area exposes its selected container, never an area-owned split layout. */
export function createPaneWorkspaceStore(scope: WorkspaceScope = 'unified', workbench = createWorkbenchStore()) {
  const current = () => {
    const state = workbench.getState().snapshot;
    return state.tabs.find(tab => tab.id === state.selected[scope] && tab.scope === scope);
  };
  const open = (layout: WorkspacePaneLayout | null, focused = '', historyIdentity?: WorkspaceHistoryIdentity) => {
    const tab: WorkspaceContainer = { id: newContainerId(), scope, layout, focused, historyIdentity };
    workbench.getState().update(state => selectContainer(putContainer(state, tab), tab.id));
    return tab.id;
  };
  const change = (apply: (tab: WorkspaceContainer) => WorkspaceContainer) => {
    const tab = current();
    if (tab) workbench.getState().update(state => putContainer(state, apply(tab)));
  };
  const store = create<PaneWorkspaceState>(set => ({
    activeTabId: '', layout: null, focused: '', startActive: true, choosingSplit: false,
    chooseMerge: pendingMergeTab => set({ pendingMergeTab }),
    selectTab: id => workbench.getState().update(state => state.tabs.some(tab => tab.scope === scope && tab.id === id) ? selectContainer(state, id) : state),
    openStart: () => {
      const tab = current() ?? workbench.getState().snapshot.tabs.find(tab => tab.scope === scope);
      if (tab) store.getState().selectTab(tab.id); else open(null);
    },
    reconcile: ids => {
      if (!workbench.getState().ready) return;
      workbench.getState().update(state => reconcileContainers(state, scope, new Set(ids)));
      if (!current()) open(null);
    },
    show: id => {
      const state = workbench.getState().snapshot;
      const existing = state.tabs.find(tab => tab.scope === scope && panesOf(tab).some(pane => pane.resourceId === id));
      if (existing) workbench.getState().update(state => focusContainerResource(state, scope, id));
      else { const layout = pane(id); open(layout, layout.id); }
    },
    split: (id, direction) => {
      const tab = current(); if (!tab?.layout) { store.getState().show(id); return; }
      store.getState().place(id, { leafId: tab.focused, dir: direction, position: 'second', rect: { x: 0, y: 0, w: 1, h: 1 } });
    },
    place: (id, target) => {
      const tab = workbench.getState().snapshot.tabs.find(tab => tab.scope === scope && panesOf(tab).some(pane => pane.id === target.leafId)); if (!tab) return;
      const existing = workbench.getState().snapshot.tabs.filter(tab => tab.scope === scope).flatMap(panesOf).find(pane => pane.resourceId === id);
      const next = existing ? { type: 'pane' as const, id: existing.id, resourceId: id } : pane(id);
      workbench.getState().update(state => placeContainerResource(state, tab.id, next, target));
    },
    removePane: id => change(tab => {
      if (panesOf(tab).length < 2) return tab;
      const ids = new Set(panesOf(tab).filter(pane => pane.id !== id).map(pane => pane.resourceId));
      return { ...tab, layout: pruneWorkspacePanes(tab.layout, ids) };
    }),
    move: (_ids, id, over, after) => workbench.getState().update(state => moveContainer(state, id, over, after)),
    ratio: (firstId, secondId, ratio) => change(tab => {
      return tab.layout ? { ...tab, layout: setWorkspacePaneRatio(tab.layout, firstId, secondId, ratio) } : tab;
    }),
    restore: (layout, focused, identity) => {
      const parsed = parseWorkspacePaneLayout(layout); if (!parsed || workspacePaneCells(parsed).some(pane => !acceptsWorkspaceResource(scope, pane.resourceId))) return;
      const existing = workbench.getState().snapshot.tabs.find(tab => tab.scope === scope && (identity ? tab.historyIdentity?.id === identity.id : JSON.stringify(panesOf(tab).map(pane => pane.resourceId).sort()) === JSON.stringify(workspacePaneCells(parsed).map(pane => pane.resourceId).sort())));
      const ids = new Set(workspacePaneCells(parsed).map(pane => pane.resourceId));
      const id = existing?.id ?? newContainerId();
      workbench.getState().update(state => selectContainer(putContainer(releaseContainerResources(state, scope, ids, id), { ...existing, id, scope, layout: parsed, focused, historyIdentity: identity }), id));
    },
    detach: resourceId => {
      const tab = current(); const cell = tab && panesOf(tab).find(pane => pane.resourceId === resourceId);
      if (!tab || !cell || panesOf(tab).length < 2) return;
      const id = newContainerId(); workbench.getState().update(state => detachContainerPane(state, tab.id, cell.id, id)); return id;
    },
    merge: (sourceId, target) => {
      const tab = current(); if (tab) workbench.getState().update(state => mergeContainers(state, sourceId, tab.id, target));
    },
  }));
  let projecting = false;
  const project = () => {
    const tab = current();
    const changed = store.getState().activeTabId !== (tab?.id ?? '');
    projecting = true;
    store.setState({ activeTabId: tab?.id ?? '', layout: tab?.layout ?? null, focused: tab?.focused ?? '', historyIdentity: tab?.historyIdentity, startActive: !tab?.layout,
      ...(changed ? { choosingSplit: false, splitAnchor: undefined, pendingMergeTab: undefined } : {}) });
    projecting = false;
  };
  workbench.subscribe(project);
  store.subscribe((state, previous) => {
    if (projecting) return;
    if (state.layout !== previous.layout || state.focused !== previous.focused || state.historyIdentity !== previous.historyIdentity) {
      if (!current() && state.layout) open(state.layout, state.focused, state.historyIdentity);
      else change(tab => ({ ...tab, layout: state.layout, focused: state.focused, historyIdentity: state.historyIdentity }));
    }
  });
  project();
  return store;
}

export const workspaceAreaStores = {
  terminal: createPaneWorkspaceStore('terminal', useWorkbenchStore),
  code: createPaneWorkspaceStore('code', useWorkbenchStore),
  ai: createPaneWorkspaceStore('ai', useWorkbenchStore),
  unified: createPaneWorkspaceStore('unified', useWorkbenchStore),
};
