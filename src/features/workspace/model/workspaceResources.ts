import { editorFileKey, type EditorFile } from '@core/editor';
import type { Tab } from '../stores/workspace';
import { measurePaneTree } from '@core/paneLayout';
import { clampPaneRatio, paneTreeOperations, type PaneTree } from '@core/paneTree';
import { leaf, leaves, type TerminalSpec, type WindowLayout } from './windowLayout';

type ResourceOwner =
  | { kind: 'terminal'; tabId: string; paneId?: string }
  | { kind: 'page'; tabId: string }
  | { kind: 'document'; file: EditorFile }
  | { kind: 'comparison'; comparisonId: string }
  | { kind: 'conversation'; sessionId: string }
  | { kind: 'agent'; sessionId: string };
export type WorkspaceResource = ResourceOwner & { id: string; title: string; dirty?: boolean };

export function workspaceResources(tabs: Tab[], nativeIds: string[], conversations: { id: string; title: string }[], agents: { id: string; harness: string }[]): WorkspaceResource[] {
  const resources: WorkspaceResource[] = [];
  for (const tab of tabs) {
    if (tab.kind === 'editor') for (const file of tab.files) resources.push({ id: `file:${editorFileKey(file)}`, title: file.path.split(/[\\/]/).pop() || file.path, kind: 'document', file });
    else if (tab.kind === 'git-diff') for (const comparison of tab.comparisons ?? [{ id: tab.id, selection: tab.selection }]) resources.push({ id: `diff:${comparison.id}`, title: comparison.selection.path, kind: 'comparison', comparisonId: comparison.id });
    else if (tab.kind === 'session') leaves(tab.layout).forEach((terminal, index) => resources.push({ id: `terminal:${terminal.id}`, title: index === 0 ? tab.title : `${tab.title} · ${index + 1}`, kind: 'terminal', tabId: tab.id, paneId: terminal.id }));
    else if (tab.kind !== 'harness' && !tab.kind.startsWith('start')) resources.push({ id: `page:${tab.id}`, title: tab.title, kind: 'page', tabId: tab.id });
  }
  for (const id of nativeIds) {
    const conversation = conversations.find(item => item.id === id);
    if (conversation) resources.push({ id: `chat:${id}`, title: conversation.title, kind: 'conversation', sessionId: id });
  }
  for (const agent of agents) resources.push({ id: `acp:${agent.id}`, title: agent.harness, kind: 'agent', sessionId: agent.id });
  return resources;
}

export type WorkspacePane = { type: 'pane'; id: string; resourceId: string };
export type WorkspacePaneLayout = PaneTree<WorkspacePane>;
const tree = paneTreeOperations<WorkspacePaneLayout, WorkspacePane>({
  leaf: node => node.type === 'pane' ? node : null,
  children: node => { const split = node as Extract<WorkspacePaneLayout, { type: 'split' }>; return [split.first, split.second]; },
  join: (node, first, second) => ({ ...node, first, second }),
  withRatio: (node, ratio) => ({ ...node, ratio }),
  id: pane => pane.id,
});

export function terminalWorkspaceLayout(layout: WindowLayout): WorkspacePaneLayout {
  return layout.type === 'leaf' ? { type: 'pane', id: layout.terminal.id, resourceId: `terminal:${layout.terminal.id}` }
    : { type: 'split', direction: layout.dir, ratio: clampPaneRatio(layout.ratio), first: terminalWorkspaceLayout(layout.first), second: terminalWorkspaceLayout(layout.second) };
}

/** The terminal wire format is an adapter of the shared reference tree. */
export function terminalResourceLayout(layout: WorkspacePaneLayout | null, terminals: readonly TerminalSpec[]): WindowLayout | null {
  if (!layout) return null;
  if (layout.type === 'pane') {
    const terminal = terminals.find(terminal => `terminal:${terminal.id}` === layout.resourceId);
    return terminal ? leaf(terminal) : null;
  }
  const first = terminalResourceLayout(layout.first, terminals); const second = terminalResourceLayout(layout.second, terminals);
  return first && second ? { type: 'split', dir: layout.direction, ratio: layout.ratio, first, second } : null;
}

export function resolveWorkspaceResource(id: string, resources: WorkspaceResource[]) {
  return resources.find(resource => resource.id === id) ?? resources.find(resource => resource.kind === 'terminal' && id === `terminal:${resource.tabId}`);
}

export function rebindWorkspaceResources(layout: WorkspacePaneLayout, resources: WorkspaceResource[]): WorkspacePaneLayout {
  if (layout.type === 'pane') {
    const resource = resolveWorkspaceResource(layout.resourceId, resources);
    return resource && resource.id !== layout.resourceId ? { ...layout, resourceId: resource.id } : layout;
  }
  const first = rebindWorkspaceResources(layout.first, resources); const second = rebindWorkspaceResources(layout.second, resources);
  return first === layout.first && second === layout.second ? layout : { ...layout, first, second };
}

export const measureWorkspacePanes = (layout: WorkspacePaneLayout, rect?: { x: number; y: number; w: number; h: number }) => measurePaneTree(layout, node => node.type === 'pane' ? { id: node.id } : { ...node, dir: node.direction }, rect);

export function workspaceSplitDirection(layout: WorkspacePaneLayout, aId: string, bId: string): 'row' | 'col' | undefined {
  return measureWorkspacePanes(layout).dividers.find(line => line.aId === aId && line.bId === bId)?.dir;
}

export function workspacePaneIds(layout: WorkspacePaneLayout): string[] {
  return tree.leaves(layout).map(pane => pane.resourceId);
}

export function pruneWorkspacePanes(layout: WorkspacePaneLayout | null, resources: ReadonlySet<string>): WorkspacePaneLayout | null {
  return layout ? tree.map(layout, (pane, node) => resources.has(pane.resourceId) ? node : null) : null;
}

export const setWorkspacePaneRatio = (layout: WorkspacePaneLayout, first: string, second: string, ratio: number) => tree.ratio(layout, first, second, ratio);
export const updateWorkspacePane = tree.update;

export function workspacePaneCells(layout: WorkspacePaneLayout, rect = { x: 0, y: 0, w: 1, h: 1 }): { id: string; resourceId: string; rect: typeof rect }[] {
  const resources = new Map(tree.leaves(layout).map(pane => [pane.id, pane.resourceId]));
  return measureWorkspacePanes(layout, rect).cells.map(cell => ({ id: cell.id, resourceId: resources.get(cell.id)!, rect: cell.rect }));
}

export function fitWorkspacePanes(layout: WorkspacePaneLayout, width: number, height: number): { layout: WorkspacePaneLayout; height: number } {
  const adapt = (node: WorkspacePaneLayout, available: number): WorkspacePaneLayout => {
    if (node.type === 'pane') return node;
    const direction = node.direction === 'row' && available < 720 ? 'col' : node.direction;
    const ratio = direction === 'row' ? Math.max(360 / available, Math.min(1 - 360 / available, node.ratio)) : node.ratio;
    return { ...node, direction, ratio, first: adapt(node.first, direction === 'row' ? available * ratio : available), second: adapt(node.second, direction === 'row' ? available * (1 - ratio) : available) };
  };
  const adapted = adapt(layout, Math.max(1, width));
  const minimumHeight = (node: WorkspacePaneLayout): number => node.type === 'pane' ? 200 : node.direction === 'col'
    ? minimumHeight(node.first) + minimumHeight(node.second) : Math.max(minimumHeight(node.first), minimumHeight(node.second));
  const actualHeight = Math.max(height, minimumHeight(adapted));
  const fit = (node: WorkspacePaneLayout, available: number): WorkspacePaneLayout => {
    if (node.type === 'pane') return node;
    const ratio = node.direction === 'col' ? Math.max(minimumHeight(node.first) / available, Math.min(1 - minimumHeight(node.second) / available, node.ratio)) : node.ratio;
    return { ...node, ratio, first: fit(node.first, node.direction === 'col' ? available * ratio : available), second: fit(node.second, node.direction === 'col' ? available * (1 - ratio) : available) };
  };
  return { layout: fit(adapted, actualHeight), height: actualHeight };
}

export function parseWorkspacePaneLayout(value: unknown): WorkspacePaneLayout | null {
  const resources = new Set<string>(); const ids = new Set<string>();
  const parse = (input: unknown, depth: number): WorkspacePaneLayout | null => {
    if (!input || typeof input !== 'object' || depth > 3) return null;
    const node = input as Record<string, unknown>;
    if (node.type === 'pane' && typeof node.id === 'string' && node.id.length > 0 && typeof node.resourceId === 'string' && node.resourceId.length > 0 && node.id.length < 256 && node.resourceId.length < 2048 && !resources.has(node.resourceId) && !ids.has(node.id)) {
      resources.add(node.resourceId); ids.add(node.id);
      return { type: 'pane', id: node.id, resourceId: node.resourceId };
    }
    if (node.type !== 'split' || node.direction !== 'row' && node.direction !== 'col' || typeof node.ratio !== 'number' || !Number.isFinite(node.ratio)) return null;
    const first = parse(node.first, depth + 1); const second = parse(node.second, depth + 1);
    return first && second ? { type: 'split', direction: node.direction, ratio: clampPaneRatio(node.ratio), first, second } : null;
  };
  const layout = parse(value, 0);
  return layout && resources.size <= 4 ? layout : null;
}

export function splitWorkspacePane(layout: WorkspacePaneLayout, target: string, pane: Extract<WorkspacePaneLayout, { type: 'pane' }>, direction: 'row' | 'col', position: 'first' | 'second' = 'second'): WorkspacePaneLayout {
  const resources = workspacePaneIds(layout);
  if (resources.length >= 4 || resources.includes(pane.resourceId) || tree.leaves(layout).some(cell => cell.id === pane.id)) return layout;
  return tree.update(layout, target, node => ({ type: 'split', direction, ratio: 0.5, first: position === 'first' ? pane : node, second: position === 'first' ? node : pane }));
}
