import { useEffect, useRef } from 'react';
import { useSessionStore, isSessionTab } from '@features/workspace';
import { leaves } from '@features/workspace/model/windowLayout';
import { useTerminalStore } from '@features/terminal';
import { sshForgetSessionAuth } from '../services/api';
import { clearSshAuthenticationMetadata, useSessionAuthenticationStore } from '../stores/sessionAuthentication';
import { useSshStore } from '../stores/store';
import { savedJumpRoute } from '../model/jumpRoute';

function dependencies(id: string | undefined, connections: ReturnType<typeof useSshStore.getState>['connections']): string[] {
  if (!id) return [];
  try { return [id, ...savedJumpRoute(connections, connections.find(connection => connection.id === id)?.jumpConnectionId, id).map(connection => connection.id)]; }
  catch { return [id]; }
}

export { requestSshAuthentication } from '../stores/sessionAuthentication';

export function useSshAuthenticationRevision(id?: string) {
  const connections = useSshStore(state => state.connections);
  return useSessionAuthenticationStore(state => dependencies(id, connections).reduce((sum, id) => sum + (state.revisions[id] ?? 0), 0));
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
  const connections = useSshStore(state => state.connections);
  useEffect(() => {
    const live = new Set(tabs.filter(isSessionTab).flatMap(tab => leaves(tab.layout))
      .filter(pane => !!sessions[pane.id] && !!pane.ssh?.connectionId).flatMap(pane => dependencies(pane.ssh!.connectionId!, connections)));
    for (const id of previous.current) {
      if (!live.has(id)) void forgetSshAuthentication(id).catch(() => {});
    }
    previous.current = live;
  }, [tabs, sessions, connections]);
}
