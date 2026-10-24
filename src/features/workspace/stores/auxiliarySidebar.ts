import { create } from 'zustand';

interface AuxiliarySidebarState {
  sshStatusOwner: string | null;
  dismissRequest: number;
  requestedPane: string | null;
  openRequest: number;
  requestOpen: (pane: string) => void;
  showSshStatus: (owner: string) => void;
  hideSshStatus: (owner: string) => void;
  dismissSshStatus: () => void;
}

export const useAuxiliarySidebarStore = create<AuxiliarySidebarState>(set => ({
  sshStatusOwner: null,
  dismissRequest: 0,
  requestedPane: null,
  openRequest: 0,
  requestOpen: requestedPane => set(state => ({ requestedPane, openRequest: state.openRequest + 1 })),
  showSshStatus: owner => set({ sshStatusOwner: owner }),
  hideSshStatus: owner => set(state => state.sshStatusOwner === owner ? { sshStatusOwner: null } : state),
  dismissSshStatus: () => set(state => ({ sshStatusOwner: null, dismissRequest: state.dismissRequest + 1 })),
}));
