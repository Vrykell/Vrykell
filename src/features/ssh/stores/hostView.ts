import { create } from 'zustand';

export const useHostView = create<{
  groupFilter: string | null;
  toggleGroupFilter: (group: string) => void;
}>(set => ({
  groupFilter: null,
  toggleGroupFilter: group => set(state => ({ groupFilter: state.groupFilter === group ? null : group })),
}));
