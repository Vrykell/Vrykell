import { create } from 'zustand';
import type { TerminalSpec } from '@features/workspace/model/windowLayout';

/** 分裂落点选择器：open=true 时显示可分裂区域，spec 为空 = 继承聚焦终端类型。 */
interface SplitPlacement {
  open: boolean;
  spec: TerminalSpec | null;
}

/** Shared pane reposition placement: one pane moves inside its current container. */
interface PaneMovePlacement {
  open: boolean;
  containerId: string;
  paneId: string;
}

interface UiState {
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  globalSearchOpen: boolean;
  setGlobalSearchOpen: (open: boolean) => void;
  /** 选类型弹窗开关 */
  splitPickerOpen: boolean;
  openSplitPicker: () => void;
  closeSplitPicker: () => void;
  /** 分裂落点选择器 */
  splitPlacement: SplitPlacement;
  beginSplit: (spec: TerminalSpec | null) => void;
  cancelSplit: () => void;
  /** Shared pane reposition placement. */
  paneMove: PaneMovePlacement;
  beginPaneMove: (containerId: string, paneId: string) => void;
  cancelPaneMove: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  settingsOpen: false,
  setSettingsOpen: settingsOpen => set({ settingsOpen }),
  paletteOpen: false,
  setPaletteOpen: (open) => set({ paletteOpen: open }),
  globalSearchOpen: false,
  setGlobalSearchOpen: (open) => set({ globalSearchOpen: open }),
  splitPickerOpen: false,
  openSplitPicker: () => set({ splitPickerOpen: true }),
  closeSplitPicker: () => set({ splitPickerOpen: false }),
  splitPlacement: { open: false, spec: null },
  beginSplit: (spec) => set({ splitPlacement: { open: true, spec: spec ?? null } }),
  cancelSplit: () => set({ splitPlacement: { open: false, spec: null } }),
  paneMove: { open: false, containerId: '', paneId: '' },
  beginPaneMove: (containerId, paneId) => set({ paneMove: { open: true, containerId, paneId } }),
  cancelPaneMove: () => set({ paneMove: { open: false, containerId: '', paneId: '' } }),
}));
