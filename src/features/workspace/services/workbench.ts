import { interceptEditorClose } from '@core/editor';
import { interceptHarnessClose } from '@core/harness';
import { useAiWorkspace } from '@features/chat/stores/aiWorkspace';
import { useChatStore } from '@features/chat/stores/chat';
import { useHarnessWorkspace } from '@features/chat/stores/harnessWorkspace';
import { useTerminalStore } from '@features/terminal/stores/terminal';
import * as groupApi from '@platform/api/group';
import { t } from '@i18n';
import { assignContainerGroup, emptyWorkbench, focusContainerResource, mergeContainers, panesOf, putContainer, reconcileContainers, releaseContainerResources, removeContainers, selectContainer, workspaceStripEntities, WORKSPACE_SCOPES, type WorkspaceContainer, type WorkspaceScope } from '../model/workbench';
import { terminalResourceLayout, terminalWorkspaceLayout } from '../model/workspaceResources';
import { leaves, type WindowLayout } from '../model/windowLayout';
import { useWorkbenchStore } from '../stores/workbench';
import { workspaceAreaStores } from '../stores/paneWorkspace';
import { useWorkspaceStore } from '../stores/workspace';
import { useWorkspaceNavigation } from '../stores/navigation';
import { useUiStore } from '../stores/ui';
import { currentWorkspaceResources, renameWorkspaceResource, workspacePaneResource } from './workspaceResources';
import { captureContainerHistory, clearWorkspaceHistorySuppression, containerHistoryIdentity, persistContainerHistory, releaseContainerHistory, settleContainerHistory, suppressWorkspaceHistory, workspaceHistoryMember } from './workspaceHistory';
import { close as closeSessionOwner, remove as removeSessionOwner, saveLayout, transferPanes, persistedSessionIds, settlePaneTransfers } from './sessionManager';
import { reportWorkbenchFailure } from '../stores/workbenchFeedback';
import type { PaneTarget } from '@core/paneLayout';
import type { WorkspaceResource } from '../model/workspaceResources';

let synchronizing = false;
const savedWorkbench = useWorkbenchStore.getState().snapshot;
const nativeScope = (kind: string): WorkspaceScope => kind === 'terminal' ? 'terminal' : kind === 'document' || kind === 'comparison' ? 'code' : 'ai';

/** Native stores are resource repositories; only the workbench owns tab placement. */
export function synchronizeWorkbench() {
  if (synchronizing) return;
  synchronizing = true;
  try {
    const workspace = useWorkspaceStore.getState(); const resources = currentWorkspaceResources().filter(resource => resource.kind !== 'page');
    const ai = useAiWorkspace.getState();
    const mainResources = resources.filter(resource => resource.kind !== 'conversation' && resource.kind !== 'agent' || ![...ai.sideSessions, ai.sideSelected].includes(resource.id));
    useWorkbenchStore.getState().update(snapshot => {
      let state = snapshot;
      for (const scope of WORKSPACE_SCOPES) {
        const valid = new Set((scope === 'unified' ? resources : mainResources.filter(resource => nativeScope(resource.kind) === scope)).map(resource => resource.id));
        if (useWorkbenchStore.getState().ready) state = reconcileContainers(state, scope, valid);
      }
      for (const tab of workspace.tabs) if (tab.kind === 'session') {
        const existing = state.tabs.find(item => item.id === tab.id);
        const focused = useTerminalStore.getState().focusedPaneId;
        state = putContainer(state, { ...existing, id: tab.id, scope: 'terminal', title: tab.title, layout: terminalWorkspaceLayout(tab.layout), focused: leaves(tab.layout).some(pane => pane.id === focused) ? focused! : existing?.focused ?? leaves(tab.layout)[0]!.id, zoomed: existing?.zoomed ?? null, groupId: tab.groupId });
      }
      for (const resource of mainResources) {
        const scope = nativeScope(resource.kind);
        if (scope === 'terminal' || state.tabs.some(tab => tab.scope === scope && panesOf(tab).some(pane => pane.resourceId === resource.id))) continue;
        releaseContainerHistory(resource.id, true);
        const paneId = `pane:${crypto.randomUUID()}`;
        state = putContainer(state, { id: resource.id, scope, layout: { type: 'pane', id: paneId, resourceId: resource.id }, focused: paneId, zoomed: null });
      }
      const groups = [...state.groups.filter(group => group.scope !== 'terminal'), ...workspace.groups.map(group => ({ ...group, scope: 'terminal' as const }))];
      const navigation = useWorkspaceNavigation.getState();
      const legacyOrders = { terminal: navigation.sessionLayoutOrder, code: [], ai: [], unified: [] };
      for (const scope of WORKSPACE_SCOPES) if (!state.order[scope] && legacyOrders[scope].length) state = { ...state, order: { ...state.order, [scope]: legacyOrders[scope] } };
      state = { ...state, groups, tabs: state.tabs.map(tab => {
        const cells = panesOf(tab); if (!cells.length) return tab;
        const members = cells.map(pane => resources.find(resource => resource.id === pane.resourceId)).map(resource => resource ? workspaceHistoryMember(resource) : null);
        if (members.some(member => !member)) return tab;
        return { ...tab, restoreSnapshot: { version: 1 as const, layout: tab.layout!, focused: tab.focused, members: members.filter((member): member is NonNullable<typeof member> => !!member) } };
      }) };
      state = removeContainers(state, new Set());
      return JSON.stringify(state) === JSON.stringify(snapshot) ? snapshot : state;
    });
  } finally { synchronizing = false; }
}

export function activateContainer(id: string) {
  synchronizeWorkbench();
  const tab = useWorkbenchStore.getState().snapshot.tabs.find(tab => tab.id === id); if (!tab) return;
  useWorkbenchStore.getState().update(state => selectContainer(state, id));
  const group = useWorkbenchStore.getState().snapshot.groups.find(group => group.id === tab.groupId);
  if (group?.collapsed) {
    const retry = () => { void updateWorkspaceGroup(group.id, { collapsed: false }).catch(error => reportWorkbenchFailure(error, retry)); };
    retry();
  }
  const cell = panesOf(tab).find(pane => pane.id === tab.focused) ?? panesOf(tab)[0];
  const resource = currentWorkspaceResources().find(resource => resource.id === cell?.resourceId);
  if (resource) workspacePaneResource(resource).activate();
  // Domain activation cannot select a different container or navigation area.
  useWorkbenchStore.getState().update(state => selectContainer(state, id));
  useWorkspaceNavigation.getState().selectArea(tab.scope);
}

export function focusNativeContainerResource(id: string) {
  const resource = currentWorkspaceResources().find(resource => resource.id === id);
  if (resource && resource.kind !== 'page') useWorkbenchStore.getState().update(state => focusContainerResource(state, nativeScope(resource.kind), id));
}

export function renameContainer(id: string, title: string) {
  const value = title.trim().slice(0, 320); if (!value) return;
  const tab = useWorkbenchStore.getState().snapshot.tabs.find(tab => tab.id === id); if (!tab) return;
  if (tab.scope === 'terminal') useWorkspaceStore.getState().renameTab(id, value);
  else if (panesOf(tab).length === 1) {
    const resource = currentWorkspaceResources().find(resource => resource.id === panesOf(tab)[0]!.resourceId);
    if (resource?.kind === 'conversation') renameWorkspaceResource(resource, value);
  }
  useWorkbenchStore.getState().update(state => putContainer(state, { ...tab, title: value }));
}

/** Collect every close guard before changing any resource or group membership. */
export function requestCloseContainers(ids: readonly string[], complete: (tabs: WorkspaceContainer[]) => void, force = false) {
  const tabs = useWorkbenchStore.getState().snapshot.tabs.filter(tab => ids.includes(tab.id));
  if (!tabs.length) return;
  const resourceIds = new Set(tabs.flatMap(panesOf).map(pane => pane.resourceId));
  const resources = currentWorkspaceResources().filter(resource => resourceIds.has(resource.id));
  requestResourceClose(resources, () => complete(tabs), force);
}

function requestResourceClose(resources: WorkspaceResource[], complete: () => void, force = false) {
  const agents = () => {
    if (!force && interceptHarnessClose(resources.flatMap(resource => resource.kind === 'agent' ? [resource.sessionId] : []), complete)) return;
    complete();
  };
  if (!force && interceptEditorClose(resources.flatMap(resource => resource.kind === 'document' ? [resource.file] : []), agents)) return;
  agents();
}

export function closeContainer(id: string, force = false) {
  requestCloseContainers([id], tabs => {
    const all = currentWorkspaceResources();
    const ids = new Set(tabs.flatMap(panesOf).map(pane => pane.resourceId));
    const scope = tabs[0]!.scope;
    let tab = tabs[0]!;
    const snapshot = captureContainerHistory(tab, all);
    const save = () => {
      const operation = persistContainerHistory(tab, snapshot);
      tab = { ...tab, historyIdentity: containerHistoryIdentity(tab) };
      void operation.catch(error => reportWorkbenchFailure(error, save));
    };
    save();
    if (scope !== 'terminal') useWorkbenchStore.setState({ lastClosed: { ...tab, historyIdentity: useWorkbenchStore.getState().snapshot.tabs.find(item => item.id === tab.id)?.historyIdentity ?? tab.historyIdentity, restoreSnapshot: snapshot ?? tab.restoreSnapshot } });
    for (const resource of all.filter(resource => ids.has(resource.id))) workspacePaneResource(resource).requestClose(true);
    useWorkbenchStore.getState().update(state => removeContainers(state, new Set([id])));
    releaseContainerHistory(id);
    synchronizeWorkbench();
    const next = useWorkbenchStore.getState().snapshot.selected[scope];
    if (next) activateContainer(next); else workspaceAreaStores[scope].getState().openStart();
  }, force);
}

export async function undoCloseContainer() {
  const tab = useWorkbenchStore.getState().lastClosed; if (!tab?.restoreSnapshot || tab.scope === 'terminal') return;
  const { restoreWorkspaceComposition } = await import('./restoreWorkspaceHistory');
  await restoreWorkspaceComposition(tab.restoreSnapshot, tab.historyIdentity, tab.scope);
  const restoredId = useWorkbenchStore.getState().snapshot.selected[tab.scope];
  const restored = useWorkbenchStore.getState().snapshot.tabs.find(item => item.id === restoredId);
  if (restored) useWorkbenchStore.getState().update(state => putContainer(state, { ...restored, title: tab.title, groupId: state.groups.some(group => group.id === tab.groupId) ? tab.groupId : undefined }));
  useWorkbenchStore.setState({ lastClosed: null });
}

export function detachWorkspacePane(scope: WorkspaceScope, resourceId: string) {
  if (scope === 'terminal') {
    const resource = currentWorkspaceResources().find(resource => resource.id === resourceId);
    if (resource?.kind === 'terminal' && resource.paneId) useWorkspaceStore.getState().detachTerminalPane(resource.paneId);
    synchronizeWorkbench();
    return;
  }
  const id = workspaceAreaStores[scope].getState().detach(resourceId);
  if (id) activateContainer(id);
}

export function zoomWorkspaceContainer(id: string) {
  const tab = useWorkbenchStore.getState().snapshot.tabs.find(tab => tab.id === id); if (!tab) return;
  const store = workspaceAreaStores[tab.scope]; store.getState().selectTab(id); store.getState().single();
}

export async function mergeWorkspaceContainers(sourceId: string, targetId: string, target: Omit<PaneTarget, 'rect'>): Promise<boolean> {
  const state = useWorkbenchStore.getState().snapshot;
  const merged = mergeContainers(state, sourceId, targetId, target); if (merged === state) return false;
  const destination = merged.tabs.find(tab => tab.id === targetId)!;
  if (destination.scope === 'terminal') {
    const layout = terminalLayoutFromContainer(destination); if (!layout) return false;
    const moved = panesOf(state.tabs.find(tab => tab.id === sourceId)!).map(pane => pane.resourceId.slice('terminal:'.length));
    useWorkspaceStore.setState(state => ({ tabs: state.tabs.filter(tab => tab.id !== sourceId).map(tab => tab.id === targetId && tab.kind === 'session' ? { ...tab, layout } : tab) }));
    useWorkbenchStore.getState().update(() => merged); saveLayout(targetId, layout);
    const transfer = async () => { await transferPanes(sourceId, targetId, moved); await closeSessionOwner(sourceId); await removeSessionOwner(sourceId); };
    const retry = () => { void transfer().catch(error => reportWorkbenchFailure(error, retry)); };
    await transfer().catch(error => reportWorkbenchFailure(error, retry));
  } else useWorkbenchStore.getState().update(() => merged);
  activateContainer(targetId); return true;
}

export function removeContainerPane(tabId: string, resourceId: string) {
  const tab = useWorkbenchStore.getState().snapshot.tabs.find(tab => tab.id === tabId);
  if (!tab || panesOf(tab).length < 2 || !panesOf(tab).some(pane => pane.resourceId === resourceId)) return;
  const resource = currentWorkspaceResources().find(resource => resource.id === resourceId); if (!resource) return;
  const complete = () => {
    workspacePaneResource(resource).requestClose(true); synchronizeWorkbench();
    if (useWorkbenchStore.getState().snapshot.tabs.some(tab => tab.id === tabId)) activateContainer(tabId);
  };
  requestResourceClose([resource], complete);
}

export async function createContainerGroup(tabId: string, title = t('New group'), requestedId?: string) {
  const tab = useWorkbenchStore.getState().snapshot.tabs.find(tab => tab.id === tabId); if (!tab?.layout) return '';
  const id = requestedId ?? `group:${tab.scope}:${crypto.randomUUID()}`;
  await groupApi.groupCreate(id, title, Date.now());
  if (tab.scope === 'terminal') useWorkspaceStore.setState(state => ({ groups: [...state.groups.filter(group => group.id !== id), { id, title, collapsed: false }] }));
  useWorkbenchStore.getState().update(state => assignContainerGroup({ ...state, groups: [...state.groups.filter(group => group.id !== id), { id, scope: tab.scope, title, collapsed: false }] }, tabId, id));
  await assignWorkspaceGroup(tabId, id);
  return id;
}

export async function assignWorkspaceGroup(tabId: string, groupId?: string) {
  const tab = useWorkbenchStore.getState().snapshot.tabs.find(tab => tab.id === tabId); if (!tab) return;
  if (groupId && !useWorkbenchStore.getState().snapshot.groups.some(group => group.id === groupId && group.scope === tab.scope)) return;
  if (tab.scope === 'terminal') {
    const persisted = await persistedSessionIds([tabId]);
    if (persisted.has(tabId)) await groupApi.sessionSetGroup(tabId, groupId ?? null);
    useWorkspaceStore.setState(state => ({ tabs: state.tabs.map(tab => tab.id === tabId && tab.kind === 'session' ? { ...tab, groupId } : tab) }));
  } else if (tab.historyIdentity) await groupApi.sessionSetGroup(tab.historyIdentity.id, groupId ?? null);
  useWorkbenchStore.getState().update(state => assignContainerGroup(state, tabId, groupId));
  await persistWorkspaceOrder(tab.scope);
}

/** Persist only this scope's visible slots; unrelated and archived history retain their order. */
export async function persistWorkspaceOrder(scope: WorkspaceScope) {
  const snapshot = useWorkbenchStore.getState().snapshot;
  const tabs = snapshot.tabs.filter(tab => tab.scope === scope);
  const groupIds = workspaceStripEntities(snapshot, scope).filter(id => id.startsWith('group:')).map(id => id.slice(6));
  await groupApi.groupsReorder(groupIds);
  const persisted = scope === 'terminal' ? await persistedSessionIds(tabs.map(tab => tab.id)) : new Set<string>();
  for (const groupId of [undefined, ...groupIds]) {
    const members = tabs.filter(tab => tab.groupId === groupId);
    const ids = members.flatMap(tab => scope === 'terminal' ? persisted.has(tab.id) ? [tab.id] : [] : tab.historyIdentity ? [tab.historyIdentity.id] : []);
    await groupApi.sessionsReorder(groupId ?? null, ids);
  }
  if (scope === 'terminal') {
    const position = new Map(tabs.map((tab, index) => [tab.id, index]));
    useWorkspaceStore.setState(state => ({ tabs: [...state.tabs].sort((a, b) => (position.get(a.id) ?? Infinity) - (position.get(b.id) ?? Infinity)) }));
  }
}

export async function updateWorkspaceGroup(id: string, patch: { title?: string; collapsed?: boolean }) {
  const group = useWorkbenchStore.getState().snapshot.groups.find(group => group.id === id); if (!group) return;
  if (patch.title !== undefined) await groupApi.groupRename(id, patch.title);
  if (patch.collapsed !== undefined) await groupApi.groupSetCollapsed(id, patch.collapsed);
  useWorkbenchStore.getState().update(state => ({ ...state, groups: state.groups.map(group => group.id === id ? { ...group, ...patch } : group) }));
  if (group.scope === 'terminal') useWorkspaceStore.setState(state => ({ groups: state.groups.map(group => group.id === id ? { ...group, ...patch } : group) }));
}

/** Deletion removes every member; archiving retains their shared history group. */
export function removeWorkspaceGroup(id: string, mode: 'delete' | 'archive', onError: (error: unknown) => void) {
  const state = useWorkbenchStore.getState().snapshot;
  const group = state.groups.find(group => group.id === id); if (!group) return;
  const tabs = state.tabs.filter(tab => tab.groupId === id && tab.scope === group.scope);
  const commit = async () => {
    const suppressed: string[] = [];
    try {
      const resources = currentWorkspaceResources();
      const terminalIds = resources.flatMap(resource => resource.kind === 'terminal' ? [resource.tabId] : []);
      await settlePaneTransfers(terminalIds); await persistedSessionIds(terminalIds);
      for (const tab of tabs) {
        const snapshot = captureContainerHistory(tab, resources);
        if (mode === 'archive' && group.scope !== 'terminal' && snapshot) {
          await persistContainerHistory(tab, snapshot);
        }
      }
      await settleContainerHistory(tabs.map(tab => tab.id));
      if (mode === 'archive') await groupApi.groupArchive(id, Date.now());
      else for (const tab of tabs) {
        const identity = containerHistoryIdentity(tab);
        if (identity) { suppressed.push(identity.id); suppressWorkspaceHistory(identity.id); }
      }
      for (const tab of tabs) {
        const memberIds = new Set(panesOf(tab).map(pane => pane.resourceId));
        for (const resource of resources.filter(resource => memberIds.has(resource.id))) {
          if (mode === 'delete') await workspacePaneResource(resource).delete();
          else workspacePaneResource(resource).requestClose(true);
        }
      }
      if (mode === 'delete') await groupApi.groupDeleteWithSessions(id);
      useWorkbenchStore.getState().update(state => ({ ...removeContainers(state, new Set(tabs.map(tab => tab.id))), groups: state.groups.filter(group => group.id !== id) }));
      for (const tab of tabs) releaseContainerHistory(tab.id);
      if (group.scope === 'terminal') useWorkspaceStore.setState(state => ({ groups: state.groups.filter(group => group.id !== id) }));
      synchronizeWorkbench();
      const next = useWorkbenchStore.getState().snapshot.selected[group.scope];
      if (next) activateContainer(next); else workspaceAreaStores[group.scope].getState().openStart();
    } catch (error) {
      for (const id of suppressed) clearWorkspaceHistorySuppression(id);
      onError(error);
    }
  };
  if (!tabs.length) { void commit(); return; }
  requestCloseContainers(tabs.map(tab => tab.id), () => { void commit(); });
}

/** Terminal persistence keeps its existing wire format at the domain boundary. */
export function terminalLayoutFromContainer(tab: WorkspaceContainer): WindowLayout | null {
  const terminals = useWorkspaceStore.getState().tabs.flatMap(tab => tab.kind === 'session' ? leaves(tab.layout) : []);
  return terminalResourceLayout(tab.layout, terminals);
}

/** Bind once per application lifetime; tests and hot reload can dispose all listeners. */
export function startWorkbenchRuntime() {
  synchronizeWorkbench();
  const update = () => synchronizeWorkbench();
  const disposers = [useWorkspaceStore.subscribe(update), useAiWorkspace.subscribe(update), useChatStore.subscribe(update), useHarnessWorkspace.subscribe(update)];
  disposers.push(useWorkbenchStore.subscribe((state, previous) => {
    if (synchronizing || state.snapshot === previous.snapshot) return;
    for (const tab of state.snapshot.tabs) {
      if (tab.scope !== 'terminal') continue;
      const native = useWorkspaceStore.getState().tabs.find(item => item.id === tab.id && item.kind === 'session');
      const layout = terminalLayoutFromContainer(tab);
      if (native?.kind === 'session' && layout && JSON.stringify(layout) !== JSON.stringify(native.layout)) useWorkspaceStore.getState().setWindowLayout(tab.id, layout);
    }
    synchronizeWorkbench();
  }));
  disposers.push(useTerminalStore.subscribe((state, before) => {
    if (state.focusedPaneId === before.focusedPaneId) return;
    const resource = currentWorkspaceResources().find(resource => resource.kind === 'terminal' && resource.paneId === state.focusedPaneId);
    if (resource) focusNativeContainerResource(resource.id);
  }));
  // A native activation may keep the same focused pane, so focus changes alone cannot track it.
  disposers.push(useWorkspaceStore.subscribe((state, before) => {
    if (state.activeId === before.activeId) return;
    const tab = state.tabs.find(tab => tab.id === state.activeId && tab.kind === 'session');
    const snapshot = useWorkbenchStore.getState().snapshot;
    if (!tab || snapshot.selected.terminal === tab.id || !snapshot.tabs.some(item => item.id === tab.id && item.scope === 'terminal')) return;
    useWorkbenchStore.getState().update(current => selectContainer(current, tab!.id));
  }));
  return () => { for (const dispose of disposers) dispose(); };
}

/** Restore references after native session hydration, preserving tab and group identities. */
export async function restoreWorkbench(mode: 'restore' | 'default' | 'empty', onError: (error: unknown) => void, saved = savedWorkbench) {
  if (mode !== 'restore') useWorkbenchStore.getState().update(() => emptyWorkbench());
  else {
    const { restoreWorkspaceMember } = await import('./restoreWorkspaceHistory');
    const { remapWorkspaceHistory } = await import('../model/workspaceHistory');
    const references = new Map<string, string>();
    for (const tab of saved.tabs) {
      if (tab.scope === 'terminal' || !tab.restoreSnapshot) continue;
      try {
        for (const member of tab.restoreSnapshot.members) if (!references.has(member.id)) references.set(member.id, await restoreWorkspaceMember(member));
        const layout = remapWorkspaceHistory(tab.restoreSnapshot, references);
        useWorkbenchStore.getState().update(state => {
          const restoredIds = new Set(panesOf({ ...tab, layout }).map(pane => pane.resourceId));
          return putContainer(releaseContainerResources(state, tab.scope, restoredIds, tab.id), { ...tab, layout });
        });
      } catch (error) { onError(error); }
    }
    for (const scope of WORKSPACE_SCOPES) {
      const id = saved.selected[scope];
      if (id) useWorkbenchStore.getState().update(state => selectContainer(state, id));
    }
  }
  useWorkbenchStore.setState({ ready: true });
  synchronizeWorkbench();
  const area = useWorkspaceNavigation.getState().area;
  const workspace = useWorkspaceStore.getState();
  const page = workspace.tabs.find(tab => tab.id === workspace.activeId);
  const utility = page && (page.kind === 'history' || page.kind === 'ai-history' || page.kind === 'usage' || page.kind.startsWith('start'));
  if (!utility && !useUiStore.getState().settingsOpen && (area === 'terminal' || area === 'code' || area === 'ai' || area === 'unified')) {
    const id = useWorkbenchStore.getState().snapshot.selected[area];
    if (id) activateContainer(id);
  }
}
