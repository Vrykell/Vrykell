import { create } from 'zustand';
import { safeJsonParse, safeLocalStorageGet, safeLocalStorageSet } from '@utils/errorHandler';
import { isHistoryGroupColor, type HistoryGroupColor } from '@ui/history/historyGroupColor';

export type WorkspaceArea = 'terminal' | 'code' | 'ai' | 'ssh' | 'forwarding' | 'history' | 'unified';
export const WORKSPACE_AREA_LABELS = { terminal: 'workspace.nav.terminals', code: 'workspace.nav.files', ai: 'workspace.nav.conversations', ssh: 'workspace.nav.hosts', forwarding: 'Port forwarding', history: 'All history', unified: 'Unified workspace' } as const;
export type HistoryTypePreset = 'all' | 'terminal' | 'conversation';
export const WORKSPACE_SIDEBAR_WIDTH = 208;
export const WORKSPACE_SIDEBAR_MIN_WIDTH = 160;
export const WORKSPACE_SIDEBAR_MAX_WIDTH = 400;
export const WORKSPACE_COMPACT_BREAKPOINT = 900;
const STORAGE_KEY = 'workspace-navigation-v1';
const DEFAULT_WORKSPACE_ORDER: WorkspaceArea[] = ['terminal', 'code', 'ai', 'ssh', 'unified'];

export { workspaceAreaForKind } from '../model/tabArea';

interface NavigationState {
  area: WorkspaceArea;
  previousArea: WorkspaceArea;
  collapsed: boolean;
  sidebarOverlay: boolean;
  sidebarWidth: number;
  sidebarDragWidth: number | null;
  lastTabs: Partial<Record<WorkspaceArea, string>>;
  groupColors: Record<string, HistoryGroupColor>;
  workspaceOrder: WorkspaceArea[];
  /** Read-only migration input; live strip order belongs to the workbench. */
  readonly sessionLayoutOrder: string[];
  aiPlacement: 'main' | 'side';
  historyPreset: HistoryTypePreset;
  historyPresetRevision: number;
  historyLoading: boolean;
  historyDestination: 'native' | 'unified';
  selectArea: (area: WorkspaceArea) => void;
  selectHistory: (preset: HistoryTypePreset) => void;
  setHistoryLoading: (loading: boolean) => void;
  rememberTab: (area: WorkspaceArea, id: string) => void;
  setCollapsed: (collapsed: boolean) => void;
  openSidebar: (overlay: boolean) => void;
  resizeSidebar: (delta: number, maxWidth: number) => void;
  commitSidebarWidth: () => void;
  resetSidebarWidth: () => void;
  setGroupColor: (id: string, color: HistoryGroupColor | null) => void;
  moveWorkspaceArea: (id: WorkspaceArea, over: WorkspaceArea, after: boolean) => void;
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
const savedWorkspaceOrder = Array.isArray(saved?.workspaceOrder)
  ? saved.workspaceOrder.filter((id): id is WorkspaceArea => DEFAULT_WORKSPACE_ORDER.includes(id as WorkspaceArea))
  : [];
const workspaceOrder = [...new Set([...savedWorkspaceOrder, ...DEFAULT_WORKSPACE_ORDER])];

/** Navigation owns presentation preferences; session and document stores retain their data. */
export const useWorkspaceNavigation = create<NavigationState>((set) => ({
  area: 'terminal', previousArea: 'terminal', collapsed: saved?.collapsed === true || window.innerWidth <= WORKSPACE_COMPACT_BREAKPOINT,
  sidebarWidth: normalizeSidebarWidth(saved?.sidebarWidth), sidebarDragWidth: null, sidebarOverlay: false,
  lastTabs: {}, groupColors, workspaceOrder, sessionLayoutOrder: Array.isArray(saved?.sessionLayoutOrder)
    ? saved.sessionLayoutOrder.filter((id): id is string => typeof id === 'string' && !id.startsWith('page:')) : [], aiPlacement: 'main',
  historyPreset: 'all', historyPresetRevision: 0, historyLoading: false, historyDestination: 'native',
  selectArea: area => set(state => ({ area, previousArea: state.area !== 'ai' ? state.area : state.previousArea,
    ...(state.sidebarOverlay && area !== state.area ? { collapsed: true, sidebarOverlay: false, sidebarDragWidth: null } : {}) })),
  selectHistory: preset => set(state => ({ area: 'history', previousArea: state.area !== 'ai' ? state.area : state.previousArea,
    historyDestination: state.area === 'history' ? state.historyDestination : state.area === 'unified' ? 'unified' : 'native',
    historyPreset: preset, historyPresetRevision: state.historyPresetRevision + 1,
    ...(state.sidebarOverlay && state.area !== 'history' ? { collapsed: true, sidebarOverlay: false, sidebarDragWidth: null } : {}) })),
  setHistoryLoading: historyLoading => set({ historyLoading }),
  rememberTab: (area, id) => set(state => state.lastTabs[area] === id ? state : ({ lastTabs: { ...state.lastTabs, [area]: id } })),
  setCollapsed: collapsed => set({ collapsed, sidebarDragWidth: null, sidebarOverlay: false }),
  openSidebar: sidebarOverlay => set({ collapsed: false, sidebarDragWidth: null, sidebarOverlay }),
  resizeSidebar: (delta, maxWidth) => set(state => {
    if (!Number.isFinite(delta) || !Number.isFinite(maxWidth)) return state;
    const current = state.sidebarDragWidth ?? Math.min(state.sidebarWidth, maxWidth);
    const next = Math.max(0, Math.min(WORKSPACE_SIDEBAR_MAX_WIDTH, maxWidth, Math.round(current + delta)));
    const collapsed = next < WORKSPACE_SIDEBAR_MIN_WIDTH;
    return { sidebarDragWidth: next, collapsed };
  }),
  commitSidebarWidth: () => set(state => ({ sidebarDragWidth: null,
    sidebarOverlay: !state.collapsed && state.sidebarOverlay,
    sidebarWidth: !state.collapsed && state.sidebarDragWidth !== null ? state.sidebarDragWidth : state.sidebarWidth })),
  resetSidebarWidth: () => set({ sidebarWidth: WORKSPACE_SIDEBAR_WIDTH, sidebarDragWidth: null, collapsed: false }),
  setGroupColor: (id, color) => set(state => {
    const colors = { ...state.groupColors };
    if (color) colors[id] = color; else delete colors[id];
    return { groupColors: colors };
  }),
  moveWorkspaceArea: (id, over, after) => set(state => {
    if (id === over) return state;
    const order = state.workspaceOrder.filter(item => item !== id);
    const index = order.indexOf(over);
    if (index < 0) return state;
    order.splice(index + (after ? 1 : 0), 0, id);
    return { workspaceOrder: order };
  }),
  setAiPlacement: aiPlacement => set({ aiPlacement }),
}));

useWorkspaceNavigation.subscribe((state, previous) => {
  if (state.collapsed !== previous.collapsed || state.sidebarOverlay !== previous.sidebarOverlay || state.groupColors !== previous.groupColors
    || state.sidebarWidth !== previous.sidebarWidth
    || state.workspaceOrder !== previous.workspaceOrder) {
    safeLocalStorageSet(STORAGE_KEY, JSON.stringify({ collapsed: state.collapsed || state.sidebarOverlay, groupColors: state.groupColors,
      sidebarWidth: state.sidebarWidth, workspaceOrder: state.workspaceOrder }));
  }
});

export function workspaceSidebarWidth(width = window.innerWidth, mainWidth = 360): number {
  const state = useWorkspaceNavigation.getState();
  const available = Math.min(WORKSPACE_SIDEBAR_MAX_WIDTH, width - mainWidth);
  return state.collapsed || state.sidebarOverlay || available < WORKSPACE_SIDEBAR_MIN_WIDTH ? 0 : Math.min(state.sidebarDragWidth ?? state.sidebarWidth, available);
}

export function orderedWorkspaceIds(ids: string[], savedOrder: string[]): string[] {
  return [...savedOrder.filter(id => ids.includes(id)), ...ids.filter(id => !savedOrder.includes(id))];
}
