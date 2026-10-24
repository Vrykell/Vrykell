import { useAuxiliarySidebarStore } from '../stores/auxiliarySidebar';

export function useSshStatusOwner() {
  return useAuxiliarySidebarStore(state => state.sshStatusOwner);
}

export function useSshStatusDismissRequest() {
  return useAuxiliarySidebarStore(state => state.dismissRequest);
}

export function useSshStatusOpenRequest(paneId?: string) {
  return useAuxiliarySidebarStore(state => state.requestedPane === paneId ? state.openRequest : 0);
}

export function showSshStatus(owner: string) {
  useAuxiliarySidebarStore.getState().showSshStatus(owner);
}

export function hideSshStatus(owner: string) {
  useAuxiliarySidebarStore.getState().hideSshStatus(owner);
}

export function dismissSshStatus() {
  useAuxiliarySidebarStore.getState().dismissSshStatus();
}
