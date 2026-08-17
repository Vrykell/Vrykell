import { create } from 'zustand';
import type { TerminalSpec } from '../lib/windowLayout';

/** 分裂落点选择器：open=true 时显示可分裂区域，spec 为空 = 继承聚焦终端类型。 */
interface SplitPlacement {
  open: boolean;
  spec: TerminalSpec | null;
}

interface UiState {
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
}

export const useUiStore = create<UiState>((set) => ({
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
}));
