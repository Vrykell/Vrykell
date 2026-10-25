import { useWorkspaceStore } from '../stores/workspace';
import { useWorkspaceNavigation } from '../stores/navigation';
import { useUnifiedWorkspace } from '../stores/unifiedWorkspace';
import { activateWorkspaceResource, currentWorkspaceResources } from './workspaceResources';
import { focusUnifiedResource } from './unifiedWorkspace';
import * as sessionManager from './sessionManager';
import { getSession } from '@platform/api/session';
import { getConversation } from '@platform/api/conversation';
import { parseEnvironment } from '@features/chat/model/conversation';
import { useChatStore } from '@features/chat/stores/chat';
import { useAiWorkspace } from '@features/chat/stores/aiWorkspace';
import { useHarnessWorkspace } from '@features/chat/stores/harnessWorkspace';
import { editorFileKey } from '@core/editor';
import { useEditorDocuments } from '@features/editor/stores/documents';
import { parseWorkspaceHistory, remapWorkspaceHistory, type WorkspaceHistoryIdentity, type WorkspaceHistoryMember, type WorkspaceHistorySnapshot } from '../model/workspaceHistory';
import { t } from '@i18n';
import { resolveWorkspaceResource, workspacePaneCells } from '../model/workspaceResources';
import { scopedPaneStores } from '../stores/scopedPanes';

const pendingMembers = new Map<string, Promise<string>>();

export function restoreWorkspaceMember(member: WorkspaceHistoryMember): Promise<string> {
  const key = JSON.stringify([member.kind, member.reference, member.paneId, member.remoteId, member.cwd, member.connectionId, member.draftId, member.scope]);
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
    const record = await getSession(member.reference);
    if (!record || record.kind === 'workspace') throw new Error(t('The saved terminal is no longer available.'));
    await sessionManager.restore(record.id, record.title);
    const resource = resolveWorkspaceResource(member.paneId ? `terminal:${member.paneId}` : `terminal:${record.id}`, currentWorkspaceResources());
    if (!resource) throw new Error(t('The saved terminal is no longer available.'));
    return resource.id;
  }
  if (member.kind === 'conversation') {
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
    const id = useHarnessWorkspace.getState().connect(member.reference, member.cwd, !member.remoteId, member.remoteId);
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
  const id = workspace.openGitDiff({ target: { cwd: member.cwd, connectionId: member.connectionId }, path: member.reference, paneId: '', scope: member.scope });
  return `diff:${id}`;
}

export async function restoreWorkspaceComposition(snapshot: WorkspaceHistorySnapshot, identity?: WorkspaceHistoryIdentity, destination: 'unified' | 'code' | 'ai' = 'unified') {
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
