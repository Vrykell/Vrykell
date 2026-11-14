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
/** Back and forward keep a bounded, session-only trail of visited workspaces. */
export const WORKSPACE_AREA_HISTORY_LIMIT = 50;
const STORAGE_KEY = 'workspace-navigation-v1';
const DEFAULT_WORKSPACE_ORDER: WorkspaceArea[] = ['terminal', 'code', 'ai', 'ssh', 'unified'];

export { workspaceAreaForKind } from '../model/tabArea';

interface NavigationState {
  area: WorkspaceArea;
  previousArea: WorkspaceArea;
  /** Session-only trail of visited workspaces for the titlebar back and forward actions. */
  areaHistory: WorkspaceArea[];
  areaHistoryIndex: number;
  collapsed: boolean;
  sidebarOverlay: boolean;
  sidebarWidth: number;
  sidebarDragWidth: number | null;
  lastTabs: Partial<Record<WorkspaceArea, string>>;
  groupColors: Record<string, HistoryGroupColor>;
  workspaceOrder: WorkspaceArea[];
  aiPlacement: 'main' | 'side';
  historyPreset: HistoryTypePreset;
  historyPresetRevision: number;
  historyLoading: boolean;
  historyDestination: 'native' | 'unified';
  selectArea: (area: WorkspaceArea, recordHistory?: boolean) => void;
  selectHistory: (preset: HistoryTypePreset, recordHistory?: boolean) => void;
  /** Move along the visited-workspace trail without recording a new entry. */
  stepAreaHistory: (direction: -1 | 1) => WorkspaceArea | null;
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

/** Record a visit without duplicating the current entry or reviving a forward branch. */
export function pushAreaHistory(history: WorkspaceArea[], index: number, area: WorkspaceArea) {
  const trimmed = history.slice(0, index + 1);
  if (trimmed[trimmed.length - 1] === area) return { areaHistory: trimmed, areaHistoryIndex: trimmed.length - 1 };
  const next = [...trimmed, area].slice(-WORKSPACE_AREA_HISTORY_LIMIT);
  return { areaHistory: next, areaHistoryIndex: next.length - 1 };
}

/**
 * Re-entering a trail entry activates panes, and that activation re-selects the same area.
 * Recording those cascaded selections would drop the branch the user is stepping through,
 * so a step runs inside this window and the trail only moves when it begins.
 */
let historySuspended = 0;
export function runWithoutAreaHistory<T>(operation: () => T): T {
  historySuspended += 1;
  try { return operation(); }
  finally { historySuspended -= 1; }
}

/** Navigation owns presentation preferences; session and document stores retain their data. */
export const useWorkspaceNavigation = create<NavigationState>((set, get) => ({
  area: 'terminal', previousArea: 'terminal', collapsed: saved?.collapsed === true || window.innerWidth <= WORKSPACE_COMPACT_BREAKPOINT,
  sidebarWidth: normalizeSidebarWidth(saved?.sidebarWidth), sidebarDragWidth: null, sidebarOverlay: false,
  lastTabs: {}, groupColors, workspaceOrder, aiPlacement: 'main',
  areaHistory: ['terminal'], areaHistoryIndex: 0,
  historyPreset: 'all', historyPresetRevision: 0, historyLoading: false, historyDestination: 'native',
  selectArea: (area, recordHistory = true) => set(state => ({
    area, previousArea: state.area !== 'ai' ? state.area : state.previousArea,
    ...(recordHistory && !historySuspended && area !== state.area ? pushAreaHistory(state.areaHistory, state.areaHistoryIndex, area) : {}),
    ...(state.sidebarOverlay && area !== state.area ? { collapsed: true, sidebarOverlay: false, sidebarDragWidth: null } : {}) })),
  selectHistory: (preset, recordHistory = true) => set(state => ({ area: 'history', previousArea: state.area !== 'ai' ? state.area : state.previousArea,
    ...(recordHistory && !historySuspended && state.area !== 'history' ? pushAreaHistory(state.areaHistory, state.areaHistoryIndex, 'history') : {}),
    historyDestination: state.area === 'history' ? state.historyDestination : state.area === 'unified' ? 'unified' : 'native',
    historyPreset: preset, historyPresetRevision: state.historyPresetRevision + 1,
    ...(state.sidebarOverlay && state.area !== 'history' ? { collapsed: true, sidebarOverlay: false, sidebarDragWidth: null } : {}) })),
  stepAreaHistory: direction => {
    const state = get();
    const index = state.areaHistoryIndex + direction;
    const target = state.areaHistory[index];
    if (!target) return null;
    set({ areaHistoryIndex: index });
    // The caller re-enters the destination through the shared area selection so panes,
    // remembered tabs and settings state resolve exactly as they do for a direct visit.
    return target;
  },
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
