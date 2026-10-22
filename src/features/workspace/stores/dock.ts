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
  chat: { id: 'chat', icon: Sparkles, get label() { return t('dock.chat'); }, width: 320 },
};

/** Every auxiliary panel has one remembered side and one stable content host. */
export type DockSide = 'left' | 'right';
export const NAVIGATION_DEFS: Record<string, Pick<PanelDef, 'id' | 'icon' | 'label'>> = {
  ...PANEL_DEFS, settings: { id: 'settings', icon: Settings, label: t('Settings') },
};
const STORAGE_KEY = 'dock-layout-v6';
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
  closePanel: (id: string) => void;
  setPanelWidth: (id: string, delta: number) => void;
  commitPanelWidth: (id: string) => void;
  reconcilePanelSpace: () => void;
}

const defaults = (): PersistedLayout => ({ leftZone: [], rightZone: [...PANEL_IDS], leftPanels: [], rightPanels: [], panelWidths: {} });

/** Keep independent sides in current layouts and migrate older right-only layouts. */
export function normalizeDockLayout(value: unknown): PersistedLayout | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  if (![data.leftZone, data.rightZone, data.leftPanels, data.rightPanels].every(Array.isArray)
    || !data.panelWidths || typeof data.panelWidths !== 'object' || Array.isArray(data.panelWidths)) return null;
  const valid = (input: unknown) => (input as unknown[]).filter((id): id is string => typeof id === 'string' && PANEL_IDS.includes(id));
  const independent = data.layoutVersion === 6;
  // The left dock holds a single panel; any extra saved entry returns to the right row.
  const leftZone = independent ? [...new Set(valid(data.leftZone))].slice(0, 1) : [];
  const rightZone = [...new Set([...valid(data.rightZone), ...valid(data.leftZone), ...PANEL_IDS])].filter(id => !leftZone.includes(id));
  const leftOpen = independent ? valid(data.leftPanels).find(id => leftZone.includes(id)) : undefined;
  const rightOpen = independent ? valid(data.rightPanels).find(id => rightZone.includes(id)) : [...valid(data.rightPanels), ...valid(data.leftPanels)][0];
  const panelWidths: Record<string, number> = {};
  for (const [id, width] of Object.entries(data.panelWidths)) {
    if (!PANEL_DEFS[id] || typeof width !== 'number' || !Number.isFinite(width)) continue;
    panelWidths[id] = Math.max(MIN_PANEL_WIDTH, data.widthPreset === 'compact' ? width : Math.min(width, PANEL_DEFS[id]!.width));
  }
  return { leftZone, rightZone, leftPanels: leftOpen ? [leftOpen] : [], rightPanels: rightOpen ? [rightOpen] : [], panelWidths };
}

function saveLayout(layout: PersistedLayout) {
  safeLocalStorageSet(STORAGE_KEY, JSON.stringify({ ...layout, widthPreset: 'compact', layoutVersion: 6 }));
}

function loadLayout(): PersistedLayout {
  const raw = safeLocalStorageGet(STORAGE_KEY) ?? safeLocalStorageGet('dock-layout-v5') ?? safeLocalStorageGet('dock-layout-v4') ?? safeLocalStorageGet('dock-layout-v3');
  if (!raw) return defaults();
  const layout = normalizeDockLayout(safeJsonParse<unknown>(raw.split('"project-commands"').join('"command-history"')));
  if (!layout) { console.warn('[dock] Invalid layout; restoring defaults'); return defaults(); }
  if ([...layout.leftPanels, ...layout.rightPanels].includes('chat')) useWorkspaceNavigation.getState().setAiPlacement('side');
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
  const mainWidth = Math.max(360, currentTerminalMinWidth());
  return window.innerWidth - workspaceSidebarWidth(window.innerWidth, mainWidth) - workspaceFrameWidth(state) - mainWidth;
}

function visiblePanels(state: DockState, ids: string[]): string[] {
  return useAuxiliarySidebarStore.getState().sshStatusOwner || availablePanelWidth(state) >= MIN_PANEL_WIDTH ? ids : [];
}

function persisted(state: DockState): PersistedLayout {
  return { leftZone: state.leftZone, leftPanels: state.leftPanels, rightZone: state.rightZone,
    rightPanels: state.rightPanels.filter(id => !state.collapsedPanels.includes(id)), panelWidths: state.panelWidths };
}

export const useDockStore = create<DockState>((set) => ({
  ...loadLayout(), collapsedPanels: [],
  moveButton: (id, to, atIndex) => set(state => {
    if (!PANEL_DEFS[id]) return state;
    const wasOpen = state.leftPanels.includes(id) || state.rightPanels.includes(id);
    if (to === 'left') {
      // The left dock holds a single panel. Docking another one returns the displaced panel
      // to the right button row, so it can always be opened again.
      const displaced = state.leftZone.filter(item => item !== id);
      const patch = { leftZone: [id],
        rightZone: [...state.rightZone.filter(item => item !== id && !displaced.includes(item)), ...displaced],
        leftPanels: wasOpen ? [id] : state.leftPanels.filter(item => item !== id),
        rightPanels: state.rightPanels.filter(item => item !== id),
        collapsedPanels: state.collapsedPanels.filter(item => item !== id) };
      saveLayout(persisted({ ...state, ...patch }));
      return patch;
    }
    const from = state.rightZone.indexOf(id);
    const zone = state.rightZone.filter(item => item !== id);
    let index = atIndex ?? state.rightZone.length;
    if (from >= 0 && from < index) index -= 1;
    zone.splice(Math.max(0, Math.min(index, zone.length)), 0, id);
    const patch = { rightZone: zone,
      leftZone: state.leftZone.filter(item => item !== id),
      leftPanels: state.leftPanels.filter(item => item !== id),
      rightPanels: wasOpen ? visiblePanels(state, [id]) : state.rightPanels.filter(item => item !== id),
      collapsedPanels: state.collapsedPanels.filter(item => item !== id) };
    saveLayout(persisted({ ...state, ...patch }));
    return patch;
  }),
  togglePanel: (_side, id) => {
    const state = useDockStore.getState();
    const open = [...state.leftPanels, ...state.rightPanels].includes(id) && !state.collapsedPanels.includes(id);
    if (open) state.closePanel(id); else state.openPanel(id);
  },
  openPanel: id => {
    const left = useDockStore.getState().leftZone.includes(id);
    if (left) {
      useWorkspaceNavigation.getState().openSidebar(window.innerWidth - Math.max(360, currentTerminalMinWidth()) < MIN_PANEL_WIDTH);
    }
    set(state => {
      if (!PANEL_DEFS[id]) return state;
      const collapsedPanels = state.collapsedPanels.filter(item => item !== id);
      const leftPanels = left ? [id] : state.leftPanels.filter(item => item !== id);
      const rightPanels = left ? state.rightPanels.filter(item => item !== id) : visiblePanels(state, [id]);
      if (id === 'chat' && (leftPanels.includes(id) || rightPanels.includes(id))) useWorkspaceNavigation.getState().setAiPlacement('side');
      const patch = { leftPanels, rightPanels, collapsedPanels };
      saveLayout(persisted({ ...state, ...patch }));
      return patch;
    });
  },
  closePanel: id => set(state => {
    // A closed left panel returns to the right button row so it stays reachable without a left toolbar.
    const wasLeft = state.leftZone.includes(id);
    const patch = { leftPanels: state.leftPanels.filter(item => item !== id), rightPanels: state.rightPanels.filter(item => item !== id),
      leftZone: state.leftZone.filter(item => item !== id),
      rightZone: wasLeft && !state.rightZone.includes(id) ? [...state.rightZone, id] : state.rightZone,
      collapsedPanels: state.collapsedPanels.filter(item => item !== id) };
    saveLayout(persisted({ ...state, ...patch })); return patch;
  }),
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
    if (rightPanels === state.rightPanels) return state;
    const patch = { rightPanels };
    saveLayout(persisted({ ...state, ...patch }));
    return patch;
  }),
}));
