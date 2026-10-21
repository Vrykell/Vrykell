import { create } from 'zustand';
import { Folder, Sparkles, Settings, Terminal, GitBranch, type AppIcon } from '@ui/icons';
import { t } from '@i18n';
import { safeJsonParse, safeLocalStorageGet, safeLocalStorageSet } from '@utils/errorHandler';
import { useWorkspaceStore, isSessionTab } from './workspace';
import { minTerminalWidth, MIN_PANE_SIZE } from '../model/windowLayout';
import { useAuxiliarySidebarStore } from './auxiliarySidebar';
import { useWorkspaceNavigation, workspaceSidebarWidth } from './navigation';

export interface PanelDef { id: string; icon: AppIcon; label: string; width: number }
export const PANEL_DEFS: Record<string, PanelDef> = {
  files: { id: 'files', icon: Folder, label: t('dock.files'), width: 200 },
  git: { id: 'git', icon: GitBranch, label: t('Source control'), width: 280 },
  'command-history': { id: 'command-history', icon: Terminal, label: t('Command history'), width: 300 },
  chat: { id: 'chat', icon: Sparkles, label: 'AI', width: 320 },
};

/** Older commands can request either side; auxiliary panels always resolve to the right. */
export type DockSide = 'left' | 'right';
export const NAVIGATION_DEFS: Record<string, Pick<PanelDef, 'id' | 'icon' | 'label'>> = {
  ...PANEL_DEFS, settings: { id: 'settings', icon: Settings, label: t('Settings') },
};
const STORAGE_KEY = 'dock-layout-v5';
const PANEL_IDS = Object.keys(PANEL_DEFS);
export const MIN_PANEL_WIDTH = 160;
export const WORKSPACE_GAP = 0;

interface PersistedLayout {
  leftZone: string[];
  rightZone: string[];
  leftPanels: string[];
  rightPanels: string[];
  panelWidths: Record<string, number>;
}

interface DockState extends PersistedLayout {
  collapsedPanels: string[];
  moveButton: (id: string, to: DockSide, atIndex?: number) => void;
  togglePanel: (side: DockSide, id: string) => void;
  openPanel: (id: string) => void;
  setPanelWidth: (id: string, delta: number) => void;
  commitPanelWidth: (id: string) => void;
  reconcilePanelSpace: () => void;
}

const defaults = (): PersistedLayout => ({ leftZone: [], rightZone: [...PANEL_IDS], leftPanels: [], rightPanels: [], panelWidths: {} });

/** Migrate saved order and widths while retiring session and host sidebars. */
export function normalizeDockLayout(value: unknown): PersistedLayout | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  if (![data.leftZone, data.rightZone, data.leftPanels, data.rightPanels].every(Array.isArray)
    || !data.panelWidths || typeof data.panelWidths !== 'object' || Array.isArray(data.panelWidths)) return null;
  const valid = (input: unknown) => (input as unknown[]).filter((id): id is string => typeof id === 'string' && PANEL_IDS.includes(id));
  const rightZone = [...new Set([...valid(data.rightZone), ...valid(data.leftZone), ...PANEL_IDS])];
  const open = [...valid(data.rightPanels), ...valid(data.leftPanels)][0];
  const panelWidths: Record<string, number> = {};
  for (const [id, width] of Object.entries(data.panelWidths)) {
    if (!PANEL_DEFS[id] || typeof width !== 'number' || !Number.isFinite(width)) continue;
    panelWidths[id] = Math.max(MIN_PANEL_WIDTH, data.widthPreset === 'compact' ? width : Math.min(width, PANEL_DEFS[id]!.width));
  }
  return { leftZone: [], rightZone, leftPanels: [], rightPanels: open ? [open] : [], panelWidths };
}

function saveLayout(layout: PersistedLayout) {
  safeLocalStorageSet(STORAGE_KEY, JSON.stringify({ ...layout, widthPreset: 'compact' }));
}

function loadLayout(): PersistedLayout {
  const raw = safeLocalStorageGet(STORAGE_KEY) ?? safeLocalStorageGet('dock-layout-v4') ?? safeLocalStorageGet('dock-layout-v3');
  if (!raw) return defaults();
  const layout = normalizeDockLayout(safeJsonParse<unknown>(raw.split('"project-commands"').join('"command-history"')));
  if (!layout) { console.warn('[dock] Invalid layout; restoring defaults'); return defaults(); }
  if (layout.rightPanels.includes('chat')) useWorkspaceNavigation.getState().setAiPlacement('side');
  saveLayout(layout);
  return layout;
}

function currentTerminalMinWidth(): number {
  const workspace = useWorkspaceStore.getState();
  const tab = workspace.tabs.find(item => item.id === workspace.activeId);
  return useWorkspaceNavigation.getState().area === 'terminal' && tab && isSessionTab(tab) ? minTerminalWidth(tab.layout) : MIN_PANE_SIZE;
}

export function workspaceFrameWidth(_state: Pick<DockState, 'leftPanels'>): number { return WORKSPACE_GAP; }

function availablePanelWidth(state: DockState): number {
  return window.innerWidth - workspaceSidebarWidth() - workspaceFrameWidth(state) - Math.max(360, currentTerminalMinWidth());
}

function visiblePanels(state: DockState, ids: string[]): string[] {
  return useAuxiliarySidebarStore.getState().sshStatusOwner || availablePanelWidth(state) >= MIN_PANEL_WIDTH ? ids : [];
}

function persisted(state: DockState): PersistedLayout {
  return { leftZone: [], leftPanels: [], rightZone: state.rightZone,
    rightPanels: state.rightPanels.filter(id => !state.collapsedPanels.includes(id)), panelWidths: state.panelWidths };
}

export const useDockStore = create<DockState>((set) => ({
  ...loadLayout(), collapsedPanels: [],
  moveButton: (id, _to, atIndex) => set(state => {
    if (!PANEL_DEFS[id]) return state;
    const current = [...new Set([...state.rightZone, ...state.leftZone])].filter(item => PANEL_DEFS[item]);
    const from = current.indexOf(id);
    if (from < 0) return state;
    const rightZone = current.filter(item => item !== id);
    let index = atIndex ?? current.length;
    if (from < index) index -= 1;
    rightZone.splice(Math.max(0, Math.min(index, rightZone.length)), 0, id);
    const rightPanels = state.leftPanels.includes(id) ? [id] : state.rightPanels;
    const patch = { leftZone: [], leftPanels: [], rightZone, rightPanels };
    saveLayout(persisted({ ...state, ...patch }));
    return patch;
  }),
  togglePanel: (_side, id) => {
    set(state => {
      if (!PANEL_DEFS[id]) return state;
      const collapsedPanels = state.collapsedPanels.filter(item => item !== id);
      const rightPanels = visiblePanels(state, state.rightPanels.includes(id) && !state.collapsedPanels.includes(id) ? [] : [id]);
      if (id === 'chat' && rightPanels.length) useWorkspaceNavigation.getState().setAiPlacement('side');
      const patch = { leftPanels: [], rightPanels, collapsedPanels };
      saveLayout(persisted({ ...state, ...patch }));
      return patch;
    });
  },
  openPanel: id => {
    set(state => {
      if (!PANEL_DEFS[id]) return state;
      const collapsedPanels = state.collapsedPanels.filter(item => item !== id);
      const rightPanels = visiblePanels(state, [id]);
      if (id === 'chat' && rightPanels.length) useWorkspaceNavigation.getState().setAiPlacement('side');
      if (state.rightPanels[0] === id && rightPanels.length && collapsedPanels.length === state.collapsedPanels.length) return state;
      const patch = { leftPanels: [], rightPanels, collapsedPanels };
      saveLayout(persisted({ ...state, ...patch }));
      return patch;
    });
  },
  setPanelWidth: (id, delta) => set(state => {
    if (!PANEL_DEFS[id] || !Number.isFinite(delta)) return state;
    const current = state.panelWidths[id] ?? PANEL_DEFS[id]!.width;
    const next = Math.round(current + delta);
    const folded = next <= MIN_PANEL_WIDTH;
    const width = folded ? MIN_PANEL_WIDTH : Math.max(MIN_PANEL_WIDTH, Math.min(Math.round(availablePanelWidth(state)), next));
    const collapsedPanels = folded ? [...new Set([...state.collapsedPanels, id])] : state.collapsedPanels.filter(item => item !== id);
    if (width === current && collapsedPanels.length === state.collapsedPanels.length) return state;
    const patch = { panelWidths: { ...state.panelWidths, [id]: width }, collapsedPanels };
    saveLayout(persisted({ ...state, ...patch }));
    return patch;
  }),
  commitPanelWidth: id => set(state => {
    if (!PANEL_DEFS[id]) return state;
    const collapsedPanels = state.collapsedPanels.filter(item => item !== id);
    const rightPanels = (state.panelWidths[id] ?? PANEL_DEFS[id]!.width) <= MIN_PANEL_WIDTH ? state.rightPanels.filter(item => item !== id) : state.rightPanels;
    const patch = { collapsedPanels, rightPanels };
    saveLayout(persisted({ ...state, ...patch }));
    return patch;
  }),
  reconcilePanelSpace: () => set(state => {
    const rightPanels = visiblePanels(state, state.rightPanels);
    if (rightPanels === state.rightPanels && !state.leftPanels.length) return state;
    const patch = { leftPanels: [], rightPanels };
    saveLayout(persisted({ ...state, ...patch }));
    return patch;
  }),
}));
