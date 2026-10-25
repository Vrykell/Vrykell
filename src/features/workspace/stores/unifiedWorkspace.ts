import { createPaneWorkspaceStore } from './paneWorkspace';
import { useWorkspaceStore, type Tab } from './workspace';
import { useWorkspaceNavigation, orderedWorkspaceIds } from './navigation';
import { parseWorkspacePaneLayout, pruneWorkspacePanes, terminalWorkspaceLayout, workspacePaneCells, type WorkspacePaneLayout } from '../model/workspaceResources';
import { leaves } from '../model/windowLayout';
import type { WorkspaceHistoryIdentity } from '../model/workspaceHistory';

export type CompositionTab = Extract<Tab, { kind: 'workspace' }>;
export const useUnifiedWorkspace = createPaneWorkspaceStore('unified-workspace-v1', false);
const engine = useUnifiedWorkspace.getState();
let syncing = false;
let bound = false;
let sequence = 0;
const cells = (layout: WorkspacePaneLayout | null) => layout ? workspacePaneCells(layout) : [];
const clearMissingZoom = () => {
  const state = useUnifiedWorkspace.getState();
  if (state.zoomed && !cells(state.layout).some(cell => cell.id === state.zoomed)) useUnifiedWorkspace.setState({ zoomed: null });
};
const single = (id: string): WorkspacePaneLayout => ({ type: 'pane', id: `workspace-pane-${Date.now()}-${sequence++}`, resourceId: id });
export const compositionTabs = () => useWorkspaceStore.getState().tabs.filter((tab): tab is CompositionTab => tab.kind === 'workspace');

function project(tab?: CompositionTab) {
  syncing = true;
  useUnifiedWorkspace.setState({ activeTabId: tab?.id ?? '', layout: tab?.paneLayout ?? null, focused: tab?.focusedPane ?? '', zoomed: tab?.zoomedPane ?? null,
    historyIdentity: tab?.historyIdentity, startOpen: !tab?.paneLayout, startActive: !tab?.paneLayout, choosingSplit: false, pendingTerminalSplit: undefined });
  syncing = false;
  clearMissingZoom();
}

function bind() {
  if (bound) return;
  bound = true;
  useUnifiedWorkspace.subscribe(state => {
    if (syncing || !state.activeTabId) return;
    const tab = compositionTabs().find(tab => tab.id === state.activeTabId);
    if (!tab) return;
    const historyIdentity = state.historyIdentity ?? tab.historyIdentity;
    if (tab.paneLayout === state.layout && tab.focusedPane === state.focused && tab.zoomedPane === state.zoomed && tab.historyIdentity === historyIdentity) return;
    useWorkspaceStore.setState(workspace => ({ tabs: workspace.tabs.map(item => item.id === tab.id ? { ...tab, paneLayout: state.layout, focusedPane: state.focused, zoomedPane: state.zoomed, historyIdentity } : item) }));
  });
  useWorkspaceStore.subscribe((state, previous) => {
    if (syncing || state.tabs === previous.tabs) return;
    const id = useUnifiedWorkspace.getState().activeTabId;
    const tab = state.tabs.find((tab): tab is CompositionTab => tab.id === id && tab.kind === 'workspace');
    if (!tab) { if (id) project(); return; }
    const before = previous.tabs.find(tab => tab.id === id);
    if (before !== tab) {
      const current = useUnifiedWorkspace.getState();
      if (current.layout !== tab.paneLayout || current.focused !== tab.focusedPane || current.historyIdentity !== tab.historyIdentity || current.zoomed !== tab.zoomedPane) project(tab);
    }
  });
}

export function selectCompositionTab(id: string) {
  bind();
  const tab = compositionTabs().find(tab => tab.id === id);
  if (!tab) return;
  project(tab);
  useWorkspaceNavigation.getState().rememberTab('unified', id);
}

function open(layout: WorkspacePaneLayout | null, focused = '', identity?: WorkspaceHistoryIdentity) {
  bind();
  const id = useWorkspaceStore.getState().openCompositionTab(layout, focused, identity);
  if (layout) useWorkspaceStore.setState(state => ({ tabs: state.tabs.filter(tab => tab.kind !== 'workspace' || tab.paneLayout || tab.id === id) }));
  selectCompositionTab(id);
  return id;
}

function current() {
  bind();
  const state = useUnifiedWorkspace.getState();
  const tab = compositionTabs().find(tab => tab.id === state.activeTabId);
  if (tab) return tab;
  const id = open(state.layout, state.focused, state.historyIdentity);
  return compositionTabs().find(tab => tab.id === id)!;
}

function release(ids: Set<string>, except: string) {
  useWorkspaceStore.setState(state => ({ tabs: state.tabs.flatMap(tab => {
    if (tab.kind !== 'workspace' || tab.id === except || !tab.paneLayout || !cells(tab.paneLayout).some(cell => ids.has(cell.resourceId))) return [tab];
    const layout = pruneWorkspacePanes(tab.paneLayout, new Set(cells(tab.paneLayout).filter(cell => !ids.has(cell.resourceId)).map(cell => cell.resourceId)));
    if (!layout) return [];
    const remaining = cells(layout);
    return [{ ...tab, paneLayout: layout, focusedPane: remaining.some(cell => cell.id === tab.focusedPane) ? tab.focusedPane : remaining[0]!.id, zoomedPane: null }];
  }) }));
}

useUnifiedWorkspace.setState({
  openStart: () => {
    const tab = compositionTabs().find(tab => tab.paneLayout) ?? compositionTabs()[0];
    if (tab) selectCompositionTab(tab.id); else open(null);
  },
  closeStart: () => {},
  show: id => {
    bind();
    const existing = compositionTabs().find(tab => cells(tab.paneLayout).some(cell => cell.resourceId === id));
    if (existing) {
      if (useUnifiedWorkspace.getState().activeTabId !== existing.id) selectCompositionTab(existing.id);
      const focused = cells(existing.paneLayout).find(cell => cell.resourceId === id)!.id;
      useUnifiedWorkspace.setState({ focused, startActive: false });
      return;
    }
    const tab = current();
    const native = useWorkspaceStore.getState().tabs.find(tab => tab.kind === 'session' && leaves(tab.layout).some(terminal => `terminal:${terminal.id}` === id));
    const group = native?.kind === 'session' ? terminalWorkspaceLayout(native.layout) : null;
    const placed = new Set(compositionTabs().flatMap(tab => cells(tab.paneLayout).map(cell => cell.resourceId)));
    const layout = group && !cells(group).some(cell => placed.has(cell.resourceId)) ? group : single(id);
    const focused = cells(layout).find(cell => cell.resourceId === id)!.id;
    if (tab.paneLayout) open(layout, focused);
    else useUnifiedWorkspace.setState({ layout, focused, startActive: false, zoomed: null });
  },
  restore: (layout, focused, identity) => {
    bind();
    const parsed = parseWorkspacePaneLayout(layout); if (!parsed) return;
    const signature = (tree: WorkspacePaneLayout | null) => JSON.stringify(cells(tree).map(cell => cell.resourceId).sort());
    const tab = compositionTabs().find(tab => identity ? tab.historyIdentity?.id === identity.id : signature(tab.paneLayout) === signature(parsed));
    const id = tab?.id ?? open(parsed, focused, identity);
    release(new Set(cells(parsed).map(cell => cell.resourceId)), id);
    if (tab) { selectCompositionTab(id); engine.restore(parsed, focused, identity); clearMissingZoom(); }
  },
  place: (id, target) => {
    const tab = current(); const before = useUnifiedWorkspace.getState().layout;
    engine.place(id, target);
    if (useUnifiedWorkspace.getState().layout !== before) { release(new Set([id]), tab.id); clearMissingZoom(); }
  },
  split: (id, direction) => {
    const tab = current(); const before = useUnifiedWorkspace.getState().layout;
    engine.split(id, direction);
    if (useUnifiedWorkspace.getState().layout !== before) { release(new Set([id]), tab.id); clearMissingZoom(); }
  },
  removePane: id => { current(); engine.removePane(id); clearMissingZoom(); },
  single: () => {
    current(); const state = useUnifiedWorkspace.getState(); const count = cells(state.layout).length;
    if (count <= 1) { if (state.zoomed) useUnifiedWorkspace.setState({ zoomed: null }); return; }
    useUnifiedWorkspace.setState({ zoomed: state.zoomed ? null : state.focused });
  },
  ratio: (...args) => { current(); engine.ratio(...args); },
  move: (ids, id, over, after) => {
    const order = orderedWorkspaceIds(ids, ids).filter(item => item !== id);
    const index = order.indexOf(over); if (index < 0 || id === over || !ids.includes(id)) return;
    order.splice(index + (after ? 1 : 0), 0, id);
    const sorted = order.map(id => compositionTabs().find(tab => tab.id === id)!); let position = 0;
    useWorkspaceStore.setState(state => ({ tabs: state.tabs.map(tab => tab.kind === 'workspace' ? sorted[position++] ?? tab : tab) }));
  },
  reconcile: ids => {
    bind();
    if (!compositionTabs().length) {
      const legacy = useUnifiedWorkspace.getState();
      if (legacy.layout) open(legacy.layout, legacy.focused, legacy.historyIdentity);
      else {
        const used = new Set<string>();
        for (const tab of useWorkspaceStore.getState().tabs) if (tab.kind === 'session') {
          const layout = terminalWorkspaceLayout(tab.layout); cells(layout).forEach(cell => used.add(cell.resourceId)); open(layout, cells(layout)[0]!.id);
        }
        for (const id of ids) if (!used.has(id)) { const layout = single(id); open(layout, cells(layout)[0]!.id); }
        if (!compositionTabs().length) open(null);
      }
    }
    const valid = new Set(ids);
    useWorkspaceStore.setState(state => {
      const tabs = state.tabs.map(tab => {
        if (tab.kind !== 'workspace') return tab;
        const layout = pruneWorkspacePanes(tab.paneLayout, valid); const remaining = cells(layout);
        if (layout === tab.paneLayout) return tab;
        return { ...tab, paneLayout: layout, focusedPane: remaining.some(cell => cell.id === tab.focusedPane) ? tab.focusedPane : remaining[0]?.id ?? '', zoomedPane: remaining.some(cell => cell.id === tab.zoomedPane) ? tab.zoomedPane : null };
      });
      const hasContent = tabs.some(tab => tab.kind === 'workspace' && tab.paneLayout);
      const empty = tabs.find(tab => tab.kind === 'workspace');
      return { tabs: tabs.filter(tab => tab.kind !== 'workspace' || (hasContent ? !!tab.paneLayout : tab.id === empty?.id)) };
    });
    if (!compositionTabs().some(tab => tab.id === useUnifiedWorkspace.getState().activeTabId)) selectCompositionTab(compositionTabs()[0]!.id);
  },
});

export function detachCompositionPane(resourceId: string) {
  const tab = current(); const pane = cells(tab.paneLayout).find(cell => cell.resourceId === resourceId);
  if (!pane || cells(tab.paneLayout).length < 2) return;
  engine.removePane(pane.id);
  clearMissingZoom();
  open({ type: 'pane', id: pane.id, resourceId: pane.resourceId }, pane.id);
}

export function mergeCompositionTab(sourceId: string, target: { leafId: string; dir: 'row' | 'col'; position: 'first' | 'second' }) {
  const tab = current(); const source = compositionTabs().find(tab => tab.id === sourceId);
  if (!tab.paneLayout || !source?.paneLayout || source.id === tab.id || cells(tab.paneLayout).length + cells(source.paneLayout).length > 4) return;
  if (!cells(tab.paneLayout).some(cell => cell.id === target.leafId)) return;
  const merge = (node: WorkspacePaneLayout): WorkspacePaneLayout => node.type === 'pane'
    ? node.id === target.leafId ? { type: 'split', direction: target.dir, ratio: 0.5, first: target.position === 'first' ? source.paneLayout! : node, second: target.position === 'first' ? node : source.paneLayout! } : node
    : { ...node, first: merge(node.first), second: merge(node.second) };
  const layout = merge(tab.paneLayout); if (!parseWorkspacePaneLayout(layout)) return;
  useWorkspaceStore.setState(state => ({ tabs: state.tabs.filter(item => item.id !== source.id).map(item => item.id === tab.id ? { ...tab, paneLayout: layout, zoomedPane: null } : item) }));
}
