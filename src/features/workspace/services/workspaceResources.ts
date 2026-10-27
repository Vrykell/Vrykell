import type { WorkspaceResource } from '../model/workspaceResources';
import { useWorkspaceStore } from '../stores/workspace';
import { useAiWorkspace } from '@features/chat/stores/aiWorkspace';
import { useChatStore } from '@features/chat/stores/chat';
import { useHarnessWorkspace } from '@features/chat/stores/harnessWorkspace';
import { closeAiWorkspaceSession } from '@features/chat/services/aiSessionClose';
import { workspaceResources } from '../model/workspaceResources';
import { useTerminalStore } from '@features/terminal/stores/terminal';
import { useWorkbenchStore } from '../stores/workbench';
import { focusContainerResource } from '../model/workbench';
import type { PaneResource } from '../model/paneResource';
import { workspaceHistoryMember } from './workspaceHistory';
import { deleteSession, deleteTerminalPanes } from '@platform/api/session';
import { useHarnessSessionRefs } from '@features/chat/stores/harnessSessions';
import { useHarnessStore } from '@features/chat/stores/harness';
import { t } from '@i18n';

export function workspacePaneResource(resource: WorkspaceResource): PaneResource {
  return {
    resource,
    capabilities: { split: resource.kind !== 'page', rename: resource.kind === 'terminal' || resource.kind === 'conversation', persist: resource.kind !== 'page' },
    activate: () => activateWorkspaceResource(resource),
    requestClose: force => closeWorkspaceResource(resource, force),
    delete: () => deleteWorkspaceResource(resource),
    serialize: () => workspaceHistoryMember(resource),
  };
}

export async function deleteWorkspaceResource(resource: WorkspaceResource) {
  const member = resource.kind === 'agent' ? workspaceHistoryMember(resource) : null;
  const session = resource.kind === 'agent' ? useHarnessStore.getState().byTab[resource.sessionId] : undefined;
  const remote = member?.remoteId ?? session?.resumeSessionId ?? session?.sessionId;
  if (resource.kind === 'terminal') {
    if (resource.paneId) await deleteTerminalPanes(resource.tabId, [resource.paneId]);
    else await deleteSession(resource.tabId);
    closeWorkspaceResource(resource, true);
    if (!useWorkspaceStore.getState().tabs.some(tab => tab.id === resource.tabId && tab.kind === 'session')) await deleteSession(resource.tabId);
    return;
  }
  closeWorkspaceResource(resource, true);
  if (resource.kind === 'conversation') {
    await useChatStore.getState().deleteConversation(resource.sessionId, { activateNext: false });
    if (useChatStore.getState().conversations.some(item => item.id === resource.sessionId)) throw new Error(useChatStore.getState().persistenceError ?? t('The conversation could not be deleted.'));
  }
  if (resource.kind === 'agent') {
    if (member && remote) useHarnessSessionRefs.getState().forget(member.reference, remote);
  }
}

export function currentWorkspaceResources() {
  return workspaceResources(useWorkspaceStore.getState().tabs, useAiWorkspace.getState().nativeTabs,
    useChatStore.getState().conversations, useHarnessWorkspace.getState().connections);
}

export function activateWorkspaceResource(resource: WorkspaceResource) {
  const workspace = useWorkspaceStore.getState();
  if (resource.kind === 'terminal') {
    workspace.activate(resource.tabId);
    if (resource.paneId) useTerminalStore.getState().setFocusedPane(resource.paneId);
  } else if (resource.kind === 'page') workspace.activate(resource.tabId);
  else if (resource.kind === 'document') workspace.openEditorFile(resource.file);
  else if (resource.kind === 'comparison') workspace.activateGitComparison(resource.comparisonId);
  else {
    workspace.openHarnessTab();
    const id = `${resource.kind === 'agent' ? 'acp' : 'chat'}:${resource.sessionId}`;
    useAiWorkspace.getState().select(id);
    if (resource.kind === 'conversation') void useChatStore.getState().selectConversation(resource.sessionId);
    else useHarnessWorkspace.getState().select(resource.sessionId);
  }
  if (resource.kind !== 'page') useWorkbenchStore.getState().update(state => focusContainerResource(state,
    resource.kind === 'terminal' ? 'terminal' : resource.kind === 'document' || resource.kind === 'comparison' ? 'code' : 'ai', resource.id));
}

export function closeWorkspaceResource(resource: WorkspaceResource, force = false) {
  const workspace = useWorkspaceStore.getState();
  if (resource.kind === 'terminal' && resource.paneId) workspace.closeTerminal(resource.paneId);
  else if (resource.kind === 'terminal' || resource.kind === 'page') workspace.closeTab(resource.tabId, force);
  else if (resource.kind === 'document') workspace.closeEditorFile(resource.file, force);
  else if (resource.kind === 'comparison') workspace.closeGitComparison(resource.comparisonId);
  else closeAiWorkspaceSession(`${resource.kind === 'agent' ? 'acp' : 'chat'}:${resource.sessionId}`, force);
}

export function renameWorkspaceResource(resource: WorkspaceResource, title: string) {
  if (resource.kind === 'terminal') useWorkspaceStore.getState().renameTab(resource.tabId, title);
  else if (resource.kind === 'conversation') useChatStore.getState().renameConversation(resource.sessionId, title);
}
