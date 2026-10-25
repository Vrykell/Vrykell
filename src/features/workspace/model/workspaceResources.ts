import { editorFileKey, type EditorFile } from '@core/editor';
import type { Tab } from '../stores/workspace';
import { measurePaneTree } from '@core/paneLayout';
import { leaves, type WindowLayout } from './windowLayout';

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
    else if (tab.kind !== 'workspace' && tab.kind !== 'harness' && !tab.kind.startsWith('start')) resources.push({ id: `page:${tab.id}`, title: tab.title, kind: 'page', tabId: tab.id });
  }
  for (const id of nativeIds) {
    const conversation = conversations.find(item => item.id === id);
    if (conversation) resources.push({ id: `chat:${id}`, title: conversation.title, kind: 'conversation', sessionId: id });
  }
  for (const agent of agents) resources.push({ id: `acp:${agent.id}`, title: agent.harness, kind: 'agent', sessionId: agent.id });
  return resources;
}

export type WorkspacePaneLayout =
  | { type: 'pane'; id: string; resourceId: string }
  | { type: 'split'; direction: 'row' | 'col'; ratio: number; first: WorkspacePaneLayout; second: WorkspacePaneLayout };

export function terminalWorkspaceLayout(layout: WindowLayout): WorkspacePaneLayout {
  return layout.type === 'leaf' ? { type: 'pane', id: layout.terminal.id, resourceId: `terminal:${layout.terminal.id}` }
    : { type: 'split', direction: layout.dir, ratio: layout.ratio, first: terminalWorkspaceLayout(layout.first), second: terminalWorkspaceLayout(layout.second) };
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

export const measureWorkspacePanes = (layout: WorkspacePaneLayout) => measurePaneTree(layout, node => node.type === 'pane' ? { id: node.id } : { ...node, dir: node.direction });

export function workspacePaneIds(layout: WorkspacePaneLayout): string[] {
  return layout.type === 'pane' ? [layout.resourceId] : [...workspacePaneIds(layout.first), ...workspacePaneIds(layout.second)];
}

export function pruneWorkspacePanes(layout: WorkspacePaneLayout | null, resources: ReadonlySet<string>): WorkspacePaneLayout | null {
  if (!layout) return null;
  if (layout.type === 'pane') return resources.has(layout.resourceId) ? layout : null;
  const first = pruneWorkspacePanes(layout.first, resources); const second = pruneWorkspacePanes(layout.second, resources);
  return first && second ? first === layout.first && second === layout.second ? layout : { ...layout, first, second } : first ?? second;
}

export function mapWorkspacePane(layout: WorkspacePaneLayout, id: string, apply: (node: WorkspacePaneLayout) => WorkspacePaneLayout): WorkspacePaneLayout {
  if (layout.type === 'pane') return layout.id === id ? apply(layout) : layout;
  return { ...layout, first: mapWorkspacePane(layout.first, id, apply), second: mapWorkspacePane(layout.second, id, apply) };
}

export function workspacePaneCells(layout: WorkspacePaneLayout, rect = { x: 0, y: 0, w: 1, h: 1 }): { id: string; resourceId: string; rect: typeof rect }[] {
  if (layout.type === 'pane') return [{ ...layout, rect }];
  const row = layout.direction === 'row'; const ratio = layout.ratio;
  return [...workspacePaneCells(layout.first, { ...rect, w: row ? rect.w * ratio : rect.w, h: row ? rect.h : rect.h * ratio }),
    ...workspacePaneCells(layout.second, { x: row ? rect.x + rect.w * ratio : rect.x, y: row ? rect.y : rect.y + rect.h * ratio, w: row ? rect.w * (1 - ratio) : rect.w, h: row ? rect.h : rect.h * (1 - ratio) })];
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
    if (node.type === 'pane' && typeof node.id === 'string' && typeof node.resourceId === 'string' && node.id.length < 256 && node.resourceId.length < 2048 && !resources.has(node.resourceId) && !ids.has(node.id)) {
      resources.add(node.resourceId); ids.add(node.id);
      return { type: 'pane', id: node.id, resourceId: node.resourceId };
    }
    if (node.type !== 'split' || node.direction !== 'row' && node.direction !== 'col' || typeof node.ratio !== 'number' || !Number.isFinite(node.ratio)) return null;
    const first = parse(node.first, depth + 1); const second = parse(node.second, depth + 1);
    return first && second ? { type: 'split', direction: node.direction, ratio: Math.max(0.2, Math.min(0.8, node.ratio)), first, second } : null;
  };
  const layout = parse(value, 0);
  return layout && resources.size <= 4 ? layout : null;
}

export function splitWorkspacePane(layout: WorkspacePaneLayout, target: string, pane: Extract<WorkspacePaneLayout, { type: 'pane' }>, direction: 'row' | 'col', position: 'first' | 'second' = 'second'): WorkspacePaneLayout {
  const resources = workspacePaneIds(layout);
  const paneIds = (node: WorkspacePaneLayout): string[] => node.type === 'pane' ? [node.id] : [...paneIds(node.first), ...paneIds(node.second)];
  if (resources.length >= 4 || resources.includes(pane.resourceId) || paneIds(layout).includes(pane.id)) return layout;
  const insert = (node: WorkspacePaneLayout): WorkspacePaneLayout => {
    if (node.type === 'pane') return node.id === target ? { type: 'split', direction, ratio: 0.5, first: position === 'first' ? pane : node, second: position === 'first' ? node : pane } : node;
    const first = insert(node.first); const second = insert(node.second);
    return first === node.first && second === node.second ? node : { ...node, first, second };
  };
  return insert(layout);
}
