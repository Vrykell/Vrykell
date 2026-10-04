import { create } from 'zustand';
import type { PageId } from '../model/navigation';

/** Retain the destination across mounting and external settings navigation. */
export const useSettingsNavigationStore = create<{
  selected: PageId;
  setSelected: (page: PageId) => void;
}>((set) => ({ selected: 'ai-model', setSelected: selected => set({ selected }) }));
