import { isSessionTab, type Tab } from './store';

export interface SessionWorkspaceSnapshot {
  tabs: Tab[];
  activeId: string;
}

/** 返回当前活动的真实会话标签，历史/设置视图不属于会话实体。 */
export function selectActiveSessionTab(snapshot: SessionWorkspaceSnapshot): Extract<Tab, { kind: 'session' }> | null {
  const activeTab = snapshot.tabs.find((tab) => tab.id === snapshot.activeId);
  return activeTab && isSessionTab(activeTab) ? activeTab : null;
}

/** 返回当前工作区中的所有真实会话标签。 */
export function selectSessionTabs(snapshot: Pick<SessionWorkspaceSnapshot, 'tabs'>): Array<Extract<Tab, { kind: 'session' }>> {
  return snapshot.tabs.filter(isSessionTab);
}
