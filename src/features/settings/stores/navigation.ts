import { create } from 'zustand';
import type { PageId } from '../model/navigation';

/** Retain the destination across mounting and external settings navigation. */
export const useSettingsNavigationStore = create<{
  selected: PageId;
  targetField: string | null;
  request: number;
  targetControl?: string;
  openField: (page: PageId, title: string, control?: string) => void;
  setSelected: (page: PageId) => void;
}>((set) => ({
  selected: 'ai-model', targetField: null, request: 0,
  setSelected: selected => set({ selected, targetField: null, targetControl: undefined }),
  openField: (selected, targetField, targetControl) => set(state => ({ selected, targetField, targetControl, request: state.request + 1 })),
}));
