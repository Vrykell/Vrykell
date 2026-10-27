import { isSessionTab, type Tab } from '@features/workspace/model/session/store';

export interface SessionWorkspaceSnapshot {
  tabs: Tab[];
  activeId: string;
}

/** Return the active tab when it is a real session; history and settings views are not session entities. */
export function selectActiveSessionTab(snapshot: SessionWorkspaceSnapshot): Extract<Tab, { kind: 'session' }> | null {
  const activeTab = snapshot.tabs.find((tab) => tab.id === snapshot.activeId);
  return activeTab && isSessionTab(activeTab) ? activeTab : null;
}

/** Return every real session tab in the workspace. */
export function selectSessionTabs(snapshot: Pick<SessionWorkspaceSnapshot, 'tabs'>): Array<Extract<Tab, { kind: 'session' }>> {
  return snapshot.tabs.filter(isSessionTab);
}
