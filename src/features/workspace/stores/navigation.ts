import { create } from 'zustand';
import { safeJsonParse, safeLocalStorageGet, safeLocalStorageSet } from '@utils/errorHandler';
import { isHistoryGroupColor, type HistoryGroupColor } from '@ui/historyGroupColor';

export type WorkspaceArea = 'terminal' | 'code' | 'ai' | 'ssh';
export const WORKSPACE_SIDEBAR_WIDTH = 208;
export const WORKSPACE_SIDEBAR_MIN_WIDTH = 160;
export const WORKSPACE_SIDEBAR_MAX_WIDTH = 400;
export const WORKSPACE_COMPACT_BREAKPOINT = 900;
const STORAGE_KEY = 'workspace-navigation-v1';

export function workspaceAreaForKind(kind: string): WorkspaceArea {
  if (kind === 'editor' || kind === 'git-diff') return 'code';
  if (kind === 'harness' || kind === 'ai-history' || kind === 'usage') return 'ai';
  return 'terminal';
}

interface NavigationState {
  area: WorkspaceArea;
  previousArea: WorkspaceArea;
  collapsed: boolean;
  sidebarWidth: number;
  sidebarDragWidth: number | null;
  lastTabs: Partial<Record<WorkspaceArea, string>>;
  groupColors: Record<string, HistoryGroupColor>;
  codeOrder: string[];
  aiPlacement: 'main' | 'side';
  selectArea: (area: WorkspaceArea) => void;
  rememberTab: (area: WorkspaceArea, id: string) => void;
  setCollapsed: (collapsed: boolean) => void;
  resizeSidebar: (delta: number, maxWidth: number) => void;
  commitSidebarWidth: () => void;
  resetSidebarWidth: () => void;
  setGroupColor: (id: string, color: HistoryGroupColor | null) => void;
  moveCodeTab: (ids: string[], id: string, over: string, after: boolean) => void;
  setAiPlacement: (placement: 'main' | 'side') => void;
}

const saved = safeJsonParse<Record<string, unknown>>(safeLocalStorageGet(STORAGE_KEY) ?? '{}');
const savedColors = saved?.groupColors;
export function normalizeSidebarWidth(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(WORKSPACE_SIDEBAR_MIN_WIDTH, Math.min(WORKSPACE_SIDEBAR_MAX_WIDTH, Math.round(value)))
    : WORKSPACE_SIDEBAR_WIDTH;
}
const groupColors: Record<string, HistoryGroupColor> = {};
if (savedColors && typeof savedColors === 'object') {
  for (const [id, color] of Object.entries(savedColors)) if (isHistoryGroupColor(color)) groupColors[id] = color;
}

/** Navigation owns presentation preferences; session and document stores retain their data. */
export const useWorkspaceNavigation = create<NavigationState>((set) => ({
  area: 'terminal', previousArea: 'terminal', collapsed: saved?.collapsed === true || window.innerWidth <= WORKSPACE_COMPACT_BREAKPOINT,
  sidebarWidth: normalizeSidebarWidth(saved?.sidebarWidth), sidebarDragWidth: null,
  lastTabs: {}, groupColors, codeOrder: [], aiPlacement: 'main',
  selectArea: area => set(state => ({ area, previousArea: state.area !== 'ai' ? state.area : state.previousArea })),
  rememberTab: (area, id) => set(state => state.lastTabs[area] === id ? state : ({ lastTabs: { ...state.lastTabs, [area]: id } })),
  setCollapsed: collapsed => set({ collapsed, sidebarDragWidth: null }),
  resizeSidebar: (delta, maxWidth) => set(state => {
    if (!Number.isFinite(delta) || !Number.isFinite(maxWidth)) return state;
    const current = state.sidebarDragWidth ?? Math.min(state.sidebarWidth, maxWidth);
    const next = Math.max(0, Math.min(WORKSPACE_SIDEBAR_MAX_WIDTH, maxWidth, Math.round(current + delta)));
    const collapsed = next < WORKSPACE_SIDEBAR_MIN_WIDTH;
    return { sidebarDragWidth: next, collapsed };
  }),
  commitSidebarWidth: () => set(state => ({ sidebarDragWidth: null,
    sidebarWidth: !state.collapsed && state.sidebarDragWidth !== null ? state.sidebarDragWidth : state.sidebarWidth })),
  resetSidebarWidth: () => set({ sidebarWidth: WORKSPACE_SIDEBAR_WIDTH, sidebarDragWidth: null, collapsed: false }),
  setGroupColor: (id, color) => set(state => {
    const colors = { ...state.groupColors };
    if (color) colors[id] = color; else delete colors[id];
    return { groupColors: colors };
  }),
  moveCodeTab: (ids, id, over, after) => set(state => {
    const order = orderedWorkspaceIds(ids, state.codeOrder).filter(key => key !== id);
    const index = order.indexOf(over);
    if (!ids.includes(id) || index < 0 || id === over) return state;
    order.splice(index + (after ? 1 : 0), 0, id);
    return { codeOrder: order };
  }),
  setAiPlacement: aiPlacement => set({ aiPlacement }),
}));

useWorkspaceNavigation.subscribe((state, previous) => {
  if (state.collapsed !== previous.collapsed || state.groupColors !== previous.groupColors || state.sidebarWidth !== previous.sidebarWidth) {
    safeLocalStorageSet(STORAGE_KEY, JSON.stringify({ collapsed: state.collapsed, groupColors: state.groupColors, sidebarWidth: state.sidebarWidth }));
  }
});

export function workspaceSidebarWidth(width = window.innerWidth, mainWidth = 360): number {
  const state = useWorkspaceNavigation.getState();
  const available = Math.min(WORKSPACE_SIDEBAR_MAX_WIDTH, width - mainWidth);
  return state.collapsed || available < WORKSPACE_SIDEBAR_MIN_WIDTH ? 0 : Math.min(state.sidebarDragWidth ?? state.sidebarWidth, available);
}

export function orderedWorkspaceIds(ids: string[], savedOrder: string[]): string[] {
  return [...savedOrder.filter(id => ids.includes(id)), ...ids.filter(id => !savedOrder.includes(id))];
}
