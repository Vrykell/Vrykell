import { create } from 'zustand';
import type { PageId } from '../model/navigation';

type ProfilePage = Extract<PageId, `profile:${string}`>;

/** Retain the destination across mounting and external settings navigation. */
export const useSettingsNavigationStore = create<{
  selected: PageId;
  targetField: string | null;
  request: number;
  targetControl?: string;
  profilePage: ProfilePage;
  openField: (page: PageId, title: string, control?: string) => void;
  setSelected: (page: PageId) => void;
}>((set) => ({
  selected: 'ai-model',
  targetField: null,
  request: 0,
  profilePage: 'profile:zsh',
  setSelected: (selected) =>
    set((state) => ({ selected, profilePage: profilePage(selected, state.profilePage), targetField: null, targetControl: undefined })),
  openField: (selected, targetField, targetControl) =>
    set((state) => ({
      selected,
      profilePage: profilePage(selected, state.profilePage),
      targetField,
      targetControl,
      request: state.request + 1,
    })),
}));

function profilePage(selected: PageId, previous: ProfilePage) {
  return selected.startsWith('profile:') ? (selected as ProfilePage) : previous;
}
