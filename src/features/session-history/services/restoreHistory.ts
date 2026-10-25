import type { UnifiedHistoryRecord } from '../model/unifiedHistory';
import type { WorkspaceHistoryMember } from '@features/workspace/model/workspaceHistory';
import { restoreWorkspaceComposition, restoreWorkspaceMember } from '@features/workspace/services/restoreWorkspaceHistory';
import { focusUnifiedResource, showUnifiedTerminalGroup } from '@features/workspace/services/unifiedWorkspace';
import { activateWorkspaceResource, currentWorkspaceResources } from '@features/workspace/services/workspaceResources';
import { selectWorkspaceArea } from '@features/workspace/services/selectWorkspaceArea';
import { useChatStore } from '@features/chat/stores/chat';

export async function restoreHistoryMember(member: WorkspaceHistoryMember, destination: 'native' | 'unified') {
  const id = await restoreWorkspaceMember(member);
  if (destination === 'unified') { focusUnifiedResource(id); return id; }
  const resource = currentWorkspaceResources().find(resource => resource.id === id);
  if (resource) activateWorkspaceResource(resource);
  selectWorkspaceArea(member.kind === 'terminal' ? 'terminal' : member.kind === 'conversation' || member.kind === 'agent' ? 'ai' : 'code');
  return id;
}

export async function restoreHistoryRecord(record: UnifiedHistoryRecord, destination: 'native' | 'unified') {
  if (record.kind === 'workspace') {
    const target = destination === 'unified' ? 'unified' : record.snapshot.members.every(member => member.kind === 'conversation' || member.kind === 'agent') ? 'ai'
      : record.snapshot.members.every(member => member.kind === 'document' || member.kind === 'comparison') ? 'code' : 'unified';
    await restoreWorkspaceComposition(record.snapshot, { id: record.session.id, createdAt: record.createdAt }, target);
    return;
  }
  if (record.kind === 'conversation' && !useChatStore.getState().conversations.some(item => item.id === record.conversation.id)) {
    useChatStore.setState(state => ({ conversations: [...state.conversations, record.conversation] }));
  }
  const member: WorkspaceHistoryMember = {
    id: record.kind === 'terminal' ? `terminal:${record.session.id}` : record.kind === 'conversation' ? `chat:${record.conversation.id}` : `acp:${record.key}`,
    title: record.title, kind: record.kind, reference: record.kind === 'terminal' ? record.session.id : record.kind === 'conversation' ? record.conversation.id : record.agent.harness,
    paneCount: record.paneCount, local: record.local, ssh: record.ssh, cwd: record.cwd, remoteId: record.kind === 'agent' ? record.agent.sessionId : undefined,
  };
  const id = await restoreWorkspaceMember(member);
  if (destination === 'unified') {
    if (record.kind === 'terminal' && record.paneCount > 1) showUnifiedTerminalGroup(record.session.id);
    else focusUnifiedResource(id);
    return;
  }
  const resource = currentWorkspaceResources().find(resource => resource.id === id);
  if (resource) activateWorkspaceResource(resource);
  selectWorkspaceArea(record.kind === 'terminal' ? 'terminal' : 'ai');
}
