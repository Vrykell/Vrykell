import { z } from 'zod';
import { parseWorkspacePaneLayout, pruneWorkspacePanes, splitWorkspacePane, updateWorkspacePane, workspacePaneCells, type WorkspacePaneLayout } from './workspaceResources';
import { parseWorkspaceHistory, type WorkspaceHistoryIdentity, type WorkspaceHistorySnapshot } from './workspaceHistory';

export const WORKSPACE_SCOPES = ['terminal', 'code', 'ai', 'unified'] as const;
export type WorkspaceScope = typeof WORKSPACE_SCOPES[number];

/** Tabs own placement; resources own processes, buffers and conversation contents. */
export interface WorkspaceContainer {
  id: string;
  scope: WorkspaceScope;
  title?: string;
  layout: WorkspacePaneLayout | null;
  focused: string;
  zoomed: string | null;
  groupId?: string;
  historyIdentity?: WorkspaceHistoryIdentity;
  restoreSnapshot?: WorkspaceHistorySnapshot;
}

export interface WorkspaceGroup {
  id: string;
  scope: WorkspaceScope;
  title: string;
  collapsed: boolean;
}

export interface WorkbenchSnapshot {
  version: 2;
  tabs: WorkspaceContainer[];
  groups: WorkspaceGroup[];
  selected: Partial<Record<WorkspaceScope, string>>;
  order: Partial<Record<WorkspaceScope, string[]>>;
}

export const emptyWorkbench = (): WorkbenchSnapshot => ({ version: 2, tabs: [], groups: [], selected: {}, order: {} });
export const panesOf = (tab: WorkspaceContainer) => tab.layout ? workspacePaneCells(tab.layout) : [];

export function acceptsWorkspaceResource(scope: WorkspaceScope, id: string): boolean {
  const prefixes = { terminal: ['terminal:'], code: ['file:', 'diff:'], ai: ['chat:', 'acp:'], unified: ['terminal:', 'file:', 'diff:', 'chat:', 'acp:'] };
  return prefixes[scope].some(prefix => id.startsWith(prefix) && id.length > prefix.length);
}

export function normalizeContainer(tab: WorkspaceContainer): WorkspaceContainer {
  const cells = panesOf(tab);
  const focused = cells.some(pane => pane.id === tab.focused) ? tab.focused : cells[0]?.id ?? '';
  const zoomed = cells.some(pane => pane.id === tab.zoomed) ? tab.zoomed : null;
  return focused === tab.focused && zoomed === tab.zoomed ? tab : { ...tab, focused, zoomed };
}

export function selectContainer(state: WorkbenchSnapshot, id: string): WorkbenchSnapshot {
  const tab = state.tabs.find(tab => tab.id === id);
  return tab ? { ...state, selected: { ...state.selected, [tab.scope]: id } } : state;
}

export function putContainer(state: WorkbenchSnapshot, tab: WorkspaceContainer): WorkbenchSnapshot {
  const existing = state.tabs.find(item => item.id === tab.id);
  if (existing && existing.scope !== tab.scope) return state;
  if (panesOf(tab).some(pane => !acceptsWorkspaceResource(tab.scope, pane.resourceId))) return state;
  const next = normalizeContainer(tab);
  const tabs = existing ? state.tabs.map(item => item.id === tab.id ? next : item) : [...state.tabs, next];
  const placeholders = next.layout ? new Set(tabs.filter(item => item.scope === next.scope && !item.layout && item.id !== next.id).map(item => item.id)) : new Set<string>();
  return placeholders.size ? removeContainers({ ...state, tabs }, placeholders) : { ...state, tabs };
}

export function removeContainers(state: WorkbenchSnapshot, ids: ReadonlySet<string>): WorkbenchSnapshot {
  const tabs = state.tabs.filter(tab => !ids.has(tab.id));
  const selected = { ...state.selected };
  for (const scope of WORKSPACE_SCOPES) {
    if (!tabs.some(tab => tab.id === selected[scope] && tab.scope === scope)) {
      const previous = state.tabs.findIndex(tab => tab.id === selected[scope]);
      const next = tabs.filter(tab => tab.scope === scope);
      const id = next.find(tab => state.tabs.indexOf(tab) >= previous)?.id ?? next[next.length - 1]?.id;
      if (id) selected[scope] = id;
      else delete selected[scope];
    }
  }
  return { ...state, tabs, selected };
}

/** A resource has one placement per scope, but can be viewed in a mixed scope too. */
export function reconcileContainers(state: WorkbenchSnapshot, scope: WorkspaceScope, valid: ReadonlySet<string>): WorkbenchSnapshot {
  const missing = new Set<string>();
  const tabs = state.tabs.map(tab => {
    if (tab.scope !== scope || !tab.layout) return tab;
    const layout = pruneWorkspacePanes(tab.layout, valid);
    if (!layout) missing.add(tab.id);
    return layout === tab.layout ? tab : normalizeContainer({ ...tab, layout });
  });
  return removeContainers({ ...state, tabs }, missing);
}

export function focusContainerResource(state: WorkbenchSnapshot, scope: WorkspaceScope, resourceId: string): WorkbenchSnapshot {
  const tab = state.tabs.find(tab => tab.scope === scope && panesOf(tab).some(pane => pane.resourceId === resourceId));
  if (!tab) return state;
  const focused = panesOf(tab).find(pane => pane.resourceId === resourceId)!.id;
  return selectContainer(putContainer(state, { ...tab, focused }), tab.id);
}

/** Move references without closing resources or changing the destination's strip position. */
export function releaseContainerResources(state: WorkbenchSnapshot, scope: WorkspaceScope, ids: ReadonlySet<string>, exceptId?: string): WorkbenchSnapshot {
  const removed = new Set<string>();
  const tabs = state.tabs.map(tab => {
    if (tab.scope !== scope || tab.id === exceptId || !tab.layout) return tab;
    const layout = pruneWorkspacePanes(tab.layout, new Set(panesOf(tab).filter(pane => !ids.has(pane.resourceId)).map(pane => pane.resourceId)));
    if (!layout) removed.add(tab.id);
    return layout === tab.layout ? tab : normalizeContainer({ ...tab, layout });
  });
  return removeContainers({ ...state, tabs }, removed);
}

export function placeContainerResource(state: WorkbenchSnapshot, tabId: string, pane: Extract<WorkspacePaneLayout, { type: 'pane' }>, target: { leafId: string; dir: 'row' | 'col'; position: 'first' | 'second' }): WorkbenchSnapshot {
  const tab = state.tabs.find(tab => tab.id === tabId);
  if (!tab?.layout || !acceptsWorkspaceResource(tab.scope, pane.resourceId)) return state;
  const layout = splitWorkspacePane(tab.layout, target.leafId, pane, target.dir, target.position);
  if (layout === tab.layout) return state;
  return selectContainer(putContainer(releaseContainerResources(state, tab.scope, new Set([pane.resourceId]), tab.id), { ...tab, layout, focused: pane.id, zoomed: null }), tab.id);
}

/** Reorder one pane inside its own container without changing its identity. */
export function moveContainerPane(state: WorkbenchSnapshot, tabId: string, paneId: string, target: { leafId: string; dir: 'row' | 'col'; position: 'first' | 'second' }): WorkbenchSnapshot {
  const tab = state.tabs.find(tab => tab.id === tabId);
  if (!tab?.layout) return state;
  const cells = panesOf(tab);
  const pane = cells.find(cell => cell.id === paneId);
  if (!pane || target.leafId === paneId) return state;
  const remaining = pruneWorkspacePanes(tab.layout, new Set(cells.filter(cell => cell.id !== paneId).map(cell => cell.resourceId)));
  if (!remaining || !workspacePaneCells(remaining).some(cell => cell.id === target.leafId)) return state;
  const layout = splitWorkspacePane(remaining, target.leafId, { type: 'pane', id: pane.id, resourceId: pane.resourceId }, target.dir, target.position);
  if (layout === remaining) return state;
  return putContainer(state, { ...tab, layout, focused: pane.id, zoomed: null });
}

export function detachContainerPane(state: WorkbenchSnapshot, tabId: string, paneId: string, newTabId: string): WorkbenchSnapshot {
  const tab = state.tabs.find(tab => tab.id === tabId);
  if (!tab || state.tabs.some(tab => tab.id === newTabId)) return state;
  const cells = panesOf(tab); const pane = cells.find(pane => pane.id === paneId);
  if (!pane || cells.length < 2) return state;
  const layout = pruneWorkspacePanes(tab.layout, new Set(cells.filter(cell => cell.id !== paneId).map(cell => cell.resourceId)));
  const next = putContainer(state, { ...tab, layout, zoomed: null });
  return selectContainer(putContainer(next, { id: newTabId, scope: tab.scope, groupId: tab.groupId, layout: { type: 'pane', id: pane.id, resourceId: pane.resourceId }, focused: pane.id, zoomed: null }), newTabId);
}

export function mergeContainers(state: WorkbenchSnapshot, sourceId: string, targetId: string, target: { leafId: string; dir: 'row' | 'col'; position: 'first' | 'second' }): WorkbenchSnapshot {
  const source = state.tabs.find(tab => tab.id === sourceId); const destination = state.tabs.find(tab => tab.id === targetId);
  if (!source?.layout || !destination?.layout || source === destination || source.scope !== destination.scope || panesOf(source).length + panesOf(destination).length > 4) return state;
  const layout = updateWorkspacePane(destination.layout, target.leafId, node => ({ type: 'split', direction: target.dir, ratio: 0.5,
    first: target.position === 'first' ? source.layout! : node, second: target.position === 'first' ? node : source.layout! }));
  if (layout === destination.layout) return state;
  if (!parseWorkspacePaneLayout(layout)) return state;
  return selectContainer(putContainer(removeContainers(state, new Set([sourceId])), { ...destination, layout, zoomed: null }), targetId);
}

export function assignContainerGroup(state: WorkbenchSnapshot, id: string, groupId: string | undefined): WorkbenchSnapshot {
  const tab = state.tabs.find(tab => tab.id === id);
  if (!tab || groupId && !state.groups.some(group => group.id === groupId && group.scope === tab.scope)) return state;
  return putContainer(state, { ...tab, groupId });
}

export function moveContainer(state: WorkbenchSnapshot, id: string, over: string, after: boolean, utilityIds: readonly string[] = []): WorkbenchSnapshot {
  const tab = state.tabs.find(tab => tab.id === id); const target = state.tabs.find(tab => tab.id === over);
  if (!tab || !target || tab.scope !== target.scope || id === over) return state;
  const next = assignContainerGroup(state, id, target.groupId);
  const moved = next.tabs.find(tab => tab.id === id)!;
  const tabs = next.tabs.filter(tab => tab.id !== id);
  tabs.splice(tabs.findIndex(tab => tab.id === over) + Number(after), 0, moved);
  const movedState = { ...next, tabs };
  return target.groupId ? movedState : moveWorkspaceEntity(movedState, tab.scope, `tab:${id}`, `tab:${over}`, after, utilityIds);
}

export function workspaceStripEntities(state: WorkbenchSnapshot, scope: WorkspaceScope, utilityIds: readonly string[] = []): string[] {
  const groups = state.groups.filter(group => group.scope === scope);
  const ids = [...groups.map(group => `group:${group.id}`), ...state.tabs.filter(tab => tab.scope === scope && (!tab.groupId || !groups.some(group => group.id === tab.groupId))).map(tab => `tab:${tab.id}`), ...utilityIds.map(id => `tab:${id}`)];
  const saved = state.order[scope] ?? [];
  return [...new Set([...saved.filter(id => ids.includes(id)), ...ids])];
}

export function moveWorkspaceEntity(state: WorkbenchSnapshot, scope: WorkspaceScope, id: string, over?: string, after = false, utilityIds: readonly string[] = []): WorkbenchSnapshot {
  const entities = workspaceStripEntities(state, scope, utilityIds);
  if (!entities.includes(id) || id === over || over && !entities.includes(over)) return state;
  const order = entities.filter(entity => entity !== id);
  order.splice(over ? order.indexOf(over) + Number(after) : order.length, 0, id);
  return { ...state, order: { ...state.order, [scope]: order } };
}

const identity = z.string().min(1).max(2048);
const scopeSchema = z.enum(WORKSPACE_SCOPES);
const layoutSchema = z.unknown().transform((value, context) => {
  if (value === null) return null;
  const layout = parseWorkspacePaneLayout(value);
  if (!layout) { context.addIssue({ code: 'custom', message: 'Invalid workspace layout' }); return z.NEVER; }
  return layout;
});
const restoreSchema = z.unknown().optional().transform((value, context) => {
  if (value === undefined) return undefined;
  const snapshot = parseWorkspaceHistory(JSON.stringify(value));
  if (!snapshot) { context.addIssue({ code: 'custom', message: 'Invalid workspace references' }); return z.NEVER; }
  return snapshot;
});
const tabSchema = z.object({ id: identity, scope: scopeSchema, title: z.string().max(320).optional(), layout: layoutSchema, focused: z.string().max(256), zoomed: z.string().max(256).nullable(), groupId: identity.optional(), historyIdentity: z.object({ id: identity.startsWith('workspace:'), createdAt: z.number().finite().nonnegative() }).optional(), restoreSnapshot: restoreSchema });
const snapshotSchema = z.object({ version: z.literal(2), tabs: z.array(tabSchema).max(4096), groups: z.array(z.object({ id: identity, scope: scopeSchema, title: z.string().min(1).max(320), collapsed: z.boolean() })).max(1024), selected: z.partialRecord(scopeSchema, identity), order: z.partialRecord(scopeSchema, z.array(identity).max(8192)).default({}) });

/** Stored state contains references only and cannot launch a resource by parsing it. */
export function parseWorkbench(value: unknown): WorkbenchSnapshot | null {
  let result: ReturnType<typeof snapshotSchema.safeParse>;
  try { result = snapshotSchema.safeParse(value); } catch { return null; }
  if (!result.success) return null;
  const state = result.data;
  if (new Set(state.tabs.map(tab => tab.id)).size !== state.tabs.length || new Set(state.groups.map(group => group.id)).size !== state.groups.length) return null;
  const placements = new Set<string>();
  for (const tab of state.tabs) {
    if (tab.groupId && !state.groups.some(group => group.id === tab.groupId && group.scope === tab.scope)) return null;
    for (const pane of panesOf(tab)) {
      if (!acceptsWorkspaceResource(tab.scope, pane.resourceId)) return null;
      const key = `${tab.scope}:${pane.resourceId}`;
      if (placements.has(key)) return null;
      placements.add(key);
    }
  }
  return removeContainers({ ...state, tabs: state.tabs.map(normalizeContainer) }, new Set());
}
