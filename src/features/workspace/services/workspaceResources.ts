import type { WorkspaceResource } from '../model/workspaceResources';
import { useWorkspaceStore } from '../stores/workspace';
import { useAiWorkspace } from '@features/chat/stores/aiWorkspace';
import { useChatStore } from '@features/chat/stores/chat';
import { useHarnessWorkspace } from '@features/chat/stores/harnessWorkspace';
import { closeAiWorkspaceSession } from '@features/chat/services/aiWorkspace';
import { workspaceResources } from '../model/workspaceResources';
import { useTerminalStore } from '@features/terminal/stores/terminal';

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
