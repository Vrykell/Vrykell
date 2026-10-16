import { useEffect, useRef } from 'react';
import { useSessionStore, isSessionTab } from '@features/workspace';
import { leaves } from '@features/workspace/model/windowLayout';
import { useTerminalStore } from '@features/terminal';
import { sshForgetSessionAuth } from '../services/api';
import { clearSshAuthenticationMetadata, useSessionAuthenticationStore } from '../stores/sessionAuthentication';

export { requestSshAuthentication } from '../stores/sessionAuthentication';

export function useSshAuthenticationRevision(id?: string) {
  return useSessionAuthenticationStore(state => id ? state.revisions[id] ?? 0 : 0);
}

export function useHasTemporarySshAuthentication(id?: string) {
  return useSessionAuthenticationStore(state => !!id && !!state.temporary[id]);
}

export async function forgetSshAuthentication(id: string) {
  await sshForgetSessionAuth(id);
  clearSshAuthenticationMetadata(id);
}

/** Forget a profile's temporary credentials when its last live terminal ends. */
export function useSshAuthenticationLifetime() {
  const tabs = useSessionStore(state => state.tabs);
  const sessions = useTerminalStore(state => state.sessions);
  const previous = useRef(new Set<string>());
  useEffect(() => {
    const live = new Set(tabs.filter(isSessionTab).flatMap(tab => leaves(tab.layout))
      .filter(pane => !!sessions[pane.id] && !!pane.ssh?.connectionId).map(pane => pane.ssh!.connectionId!));
    for (const id of previous.current) {
      if (!live.has(id)) void forgetSshAuthentication(id).catch(() => {});
    }
    previous.current = live;
  }, [tabs, sessions]);
}
