import { useWorkspaceStore } from '../stores/workspace';
import { useWorkspaceNavigation } from '../stores/navigation';
import { useUnifiedWorkspace } from '../stores/unifiedWorkspace';
import { activateWorkspaceResource, currentWorkspaceResources } from './workspaceResources';
import { focusUnifiedResource } from './unifiedWorkspace';
import { clearWorkspaceHistorySuppression } from './workspaceHistory';
import * as sessionManager from './sessionManager';
import { getSession } from '@platform/api/session';
import { getConversation } from '@platform/api/conversation';
import { parseEnvironment } from '@features/chat/model/conversation';
import { useChatStore } from '@features/chat/stores/chat';
import { useAiWorkspace } from '@features/chat/stores/aiWorkspace';
import { useHarnessWorkspace } from '@features/chat/stores/harnessWorkspace';
import { editorFileKey } from '@core/editor';
import { gitComparisonKey } from '@core/git';
import { useEditorDocuments } from '@features/editor/stores/documents';
import { parseWorkspaceHistory, remapWorkspaceHistory, type WorkspaceHistoryIdentity, type WorkspaceHistoryMember, type WorkspaceHistorySnapshot } from '../model/workspaceHistory';
import { t } from '@i18n';
import { resolveWorkspaceResource, workspacePaneCells } from '../model/workspaceResources';
import { scopedPaneStores } from '../stores/scopedPanes';
import { SHELL_TYPES } from '@platform/shells';
import { useSshStore } from '@features/ssh/stores/store';
import { connectionTarget } from '@features/ssh/services/api';

const pendingMembers = new Map<string, Promise<string>>();

export function restoreWorkspaceMember(member: WorkspaceHistoryMember): Promise<string> {
  const key = JSON.stringify([member.kind, member.reference, member.paneId, member.remoteId, member.cwd, member.connectionId, member.draftId, member.scope, member.empty]);
  const pending = pendingMembers.get(key);
  if (pending) return pending;
  const area = useWorkspaceNavigation.getState().area;
  const operation = restoreMemberResource(member).finally(() => {
    pendingMembers.delete(key);
    useWorkspaceNavigation.getState().selectArea(area);
  });
  pendingMembers.set(key, operation);
  return operation;
}

async function restoreMemberResource(member: WorkspaceHistoryMember): Promise<string> {
  const existing = resolveWorkspaceResource(member.id, currentWorkspaceResources());
  if (existing && existing.kind === member.kind && (member.kind !== 'terminal' || !member.paneId || existing.kind === 'terminal' && existing.paneId === member.paneId)) return existing.id;
  const workspace = useWorkspaceStore.getState();
  if (member.kind === 'terminal') {
    if (member.empty) {
      if (member.ssh) {
        if (!useSshStore.getState().loaded) await useSshStore.getState().load();
        const connection = useSshStore.getState().connections.find(item => item.id === member.connectionId);
        if (!connection) throw new Error(t('The saved terminal is no longer available.'));
        const id = workspace.addTab({ kind: 'ssh', title: member.title, cwd: member.cwd, ssh: connectionTarget(connection) });
        return `terminal:${id}#0`;
      }
      const id = workspace.addTab({ title: member.title, cwd: member.cwd, shellType: SHELL_TYPES.find(type => type === member.shellType) });
      return `terminal:${id}#0`;
    }
    const record = await getSession(member.reference);
    if (!record || record.kind === 'workspace') throw new Error(t('The saved terminal is no longer available.'));
    await sessionManager.restore(record.id, record.title);
    const resource = resolveWorkspaceResource(member.paneId ? `terminal:${member.paneId}` : `terminal:${record.id}`, currentWorkspaceResources());
    if (!resource) throw new Error(t('The saved terminal is no longer available.'));
    return resource.id;
  }
  if (member.kind === 'conversation') {
    if (member.empty && !useChatStore.getState().conversations.some(item => item.id === member.reference)) {
      const id = useChatStore.getState().createConversation(null, { activate: false });
      useChatStore.getState().renameConversation(id, member.title);
      useAiWorkspace.getState().openNative(id);
      await useChatStore.getState().selectConversation(id);
      workspace.openHarnessTab();
      return `chat:${id}`;
    }
    if (!useChatStore.getState().conversations.some(conversation => conversation.id === member.reference)) {
      const record = await getConversation(member.reference);
      if (record) useChatStore.setState(state => ({ conversations: [...state.conversations.filter(conversation => conversation.id !== record.id), {
        id: record.id, title: record.title, createdAt: record.created_at, updatedAt: record.updated_at, environment: parseEnvironment(record.environment),
      }] }));
    }
    if (!useChatStore.getState().conversations.some(conversation => conversation.id === member.reference)) throw new Error(t('The saved conversation is no longer available.'));
    useAiWorkspace.getState().openNative(member.reference);
    await useChatStore.getState().selectConversation(member.reference);
    workspace.openHarnessTab();
    return `chat:${member.reference}`;
  }
  if (member.kind === 'agent') {
    const id = useHarnessWorkspace.getState().connect(member.reference, member.cwd, member.empty || !member.remoteId, member.empty ? undefined : member.remoteId);
    workspace.openHarnessTab();
    return `acp:${id}`;
  }
  if (member.kind === 'document') {
    const file = { path: member.reference, connectionId: member.connectionId, draftId: member.draftId };
    if (file.draftId && !useEditorDocuments.getState().documents[editorFileKey(file)]) throw new Error(t('The unsaved document is no longer available.'));
    workspace.openEditorFile(file);
    return `file:${editorFileKey(file)}`;
  }
  if (!member.scope || !member.cwd) throw new Error(t('The saved comparison is no longer available.'));
  const selection = { target: { cwd: member.cwd, connectionId: member.connectionId }, path: member.reference, paneId: '', scope: member.scope };
  workspace.openGitDiff(selection);
  const comparison = useWorkspaceStore.getState().tabs
    .flatMap(tab => tab.kind === 'git-diff' ? tab.comparisons ?? [{ id: tab.id, selection: tab.selection }] : [])
    .find(item => gitComparisonKey(item.selection) === gitComparisonKey(selection));
  if (!comparison) throw new Error(t('The saved comparison is no longer available.'));
  return `diff:${comparison.id}`;
}

export async function restoreWorkspaceComposition(snapshot: WorkspaceHistorySnapshot, identity?: WorkspaceHistoryIdentity, destination: 'unified' | 'code' | 'ai' = 'unified') {
  if (identity) clearWorkspaceHistorySuppression(identity.id);
  const parsed = parseWorkspaceHistory(JSON.stringify(snapshot));
  if (!parsed) throw new Error(t('The saved workspace layout is invalid.'));
  const references = new Map<string, string>();
  for (const member of parsed.members) references.set(member.id, await restoreWorkspaceMember(member));
  const layout = remapWorkspaceHistory(parsed, references);
  const store = destination === 'unified' ? useUnifiedWorkspace : scopedPaneStores[destination];
  store.getState().restore(layout, parsed.focused, identity);
  const cells = workspacePaneCells(layout);
  const id = (cells.find(cell => cell.id === parsed.focused) ?? cells[0])!.resourceId;
  if (destination === 'unified') focusUnifiedResource(id);
  else { const resource = currentWorkspaceResources().find(resource => resource.id === id); if (resource) activateWorkspaceResource(resource); }
  useWorkspaceNavigation.getState().selectArea(destination);
}
