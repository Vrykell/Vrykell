import { saveWorkspaceHistory } from '@platform/api/historyPage';
import { useWorkspaceStore, terminalsOf } from '../stores/workspace';
import { useChatStore } from '@features/chat/stores/chat';
import { useHarnessWorkspace } from '@features/chat/stores/harnessWorkspace';
import { useHarnessStore } from '@features/chat/stores/harness';
import { useBlockStore } from '@features/terminal/stores/blocks';
import { hasChatContent } from '@features/chat/model/chatContent';
import { workspacePaneCells, type WorkspacePaneLayout, type WorkspaceResource } from '../model/workspaceResources';
import type { WorkspaceHistoryIdentity, WorkspaceHistoryMember, WorkspaceHistorySnapshot } from '../model/workspaceHistory';

export function workspaceHistoryMember(resource: WorkspaceResource): WorkspaceHistoryMember | null {
  const base = { id: resource.id, title: resource.title.slice(0, 320), paneCount: 1, local: false, ssh: false,
    ...(!workspaceResourceHasContent(resource) ? { empty: true } : {}) };
  if (resource.kind === 'terminal') {
    const tab = useWorkspaceStore.getState().tabs.find(tab => tab.id === resource.tabId);
    const terminals = tab ? terminalsOf(tab).filter(terminal => !resource.paneId || terminal.id === resource.paneId) : [];
    return { ...base, kind: 'terminal', reference: resource.tabId, paneId: resource.paneId, paneCount: Math.max(1, terminals.length),
      local: terminals.some(terminal => terminal.kind === 'local'), ssh: terminals.some(terminal => terminal.kind === 'ssh'),
      cwd: terminals[0]?.cwd, shellType: terminals[0]?.shellType, connectionId: terminals[0]?.ssh?.connectionId,
      modes: [...new Set(terminals.flatMap(terminal => terminal.openMode ? [terminal.openMode] : []))] };
  }
  if (resource.kind === 'conversation') {
    const environment = useChatStore.getState().conversations.find(conversation => conversation.id === resource.sessionId)?.environment;
    return { ...base, kind: 'conversation', reference: resource.sessionId, local: environment?.kind === 'local', ssh: environment?.kind === 'ssh', cwd: environment?.cwd };
  }
  if (resource.kind === 'agent') {
    const connection = useHarnessWorkspace.getState().connections.find(connection => connection.id === resource.sessionId);
    if (!connection) return null;
    const session = useHarnessStore.getState().byTab[resource.sessionId];
    return { ...base, kind: 'agent', reference: connection.harness, local: true, cwd: connection.cwd, remoteId: base.empty ? undefined : session?.resumeSessionId ?? session?.sessionId ?? undefined };
  }
  if (resource.kind === 'document') return { ...base, kind: 'document', reference: resource.file.path,
    connectionId: resource.file.connectionId, draftId: resource.file.draftId, local: !resource.file.connectionId, ssh: !!resource.file.connectionId };
  if (resource.kind === 'comparison') {
    const tabs = useWorkspaceStore.getState().tabs;
    for (const tab of tabs) {
      if (tab.kind !== 'git-diff') continue;
      const comparison = (tab.comparisons ?? [{ id: tab.id, selection: tab.selection }]).find(item => item.id === resource.comparisonId);
      if (comparison) return { ...base, kind: 'comparison', reference: comparison.selection.path, cwd: comparison.selection.target.cwd,
        connectionId: comparison.selection.target.connectionId, scope: comparison.selection.scope, local: !comparison.selection.target.connectionId, ssh: !!comparison.selection.target.connectionId };
    }
  }
  return null;
}

function workspaceResourceHasContent(resource: WorkspaceResource): boolean {
  if (resource.kind === 'conversation') {
    const messages = useChatStore.getState().byTab[resource.sessionId];
    return messages ? messages.some(hasChatContent) : useChatStore.getState().conversations.some(item => item.id === resource.sessionId);
  }
  if (resource.kind === 'agent') return !!useHarnessStore.getState().byTab[resource.sessionId]?.messages.some(hasChatContent);
  if (resource.kind === 'terminal') {
    const blocks = useBlockStore.getState().byTab;
    return Object.entries(blocks).some(([paneId, items]) => (resource.paneId ? paneId === resource.paneId : paneId === resource.tabId || paneId.startsWith(`${resource.tabId}#`))
      && items.some(block => block.command.trim() || block.outputText.trim() || block.outputRaw.trim()));
  }
  return true;
}

export function captureWorkspaceHistory(layout: WorkspacePaneLayout | null, focused: string, resources: WorkspaceResource[], includeSingle = false): WorkspaceHistorySnapshot | null {
  if (!layout) return null;
  const cells = workspacePaneCells(layout);
  if (cells.length < (includeSingle ? 1 : 2)) return null;
  if (!cells.some(cell => {
    const resource = resources.find(item => item.id === cell.resourceId);
    return resource && workspaceResourceHasContent(resource);
  })) return null;
  const members = cells.map(cell => {
    const resource = resources.find(resource => resource.id === cell.resourceId);
    return resource ? workspaceHistoryMember(resource) : null;
  });
  if (members.some(member => !member)) return null;
  return { version: 1, layout, focused: cells.some(cell => cell.id === focused) ? focused : cells[0]!.id, members: members as WorkspaceHistoryMember[] };
}

export function createWorkspaceHistoryWriter(onError: (error: unknown) => void, onIdentity?: (identity: WorkspaceHistoryIdentity) => void) {
  let signature = '';
  let id = '';
  let createdAt = 0;
  let lastPayload = '';
  let lastTitle = '';
  let queue = Promise.resolve();
  return (snapshot: WorkspaceHistorySnapshot | null, identity?: WorkspaceHistoryIdentity, titleOverride?: string) => {
    if (!snapshot) { signature = ''; return queue; }
    const nextSignature = JSON.stringify(snapshot.members.map(member => member.id).sort());
    if (identity && identity.id !== id) {
      id = identity.id; createdAt = identity.createdAt; signature = nextSignature; lastPayload = ''; lastTitle = '';
    } else if (!identity && signature !== nextSignature) {
      signature = nextSignature;
      createdAt = Date.now();
      id = `workspace:${crypto.randomUUID()}`;
      lastPayload = ''; lastTitle = '';
    }
    if (suppressedHistoryIds.has(id)) return queue;
    if (!identity || identity.id !== id) onIdentity?.({ id, createdAt });
    const payload = JSON.stringify(snapshot);
    const title = (titleOverride?.trim() || snapshot.members.map(member => member.title).join(' + ')).slice(0, 320);
    if (payload === lastPayload && title === lastTitle) return queue;
    const request = { id, createdAt, timestamp: Date.now(), title, payload };
    lastPayload = payload;
    lastTitle = title;
    queue = queue.then(() => {
      if (suppressedHistoryIds.has(id)) return;
      return saveWorkspaceHistory(request);
    }).catch(error => { lastPayload = ''; lastTitle = ''; onError(error); });
    return queue;
  };
}

const suppressedHistoryIds = new Set<string>();

/** Keep a deleted live composition from being written back by its pending writer. */
export function suppressWorkspaceHistory(id: string) {
  suppressedHistoryIds.add(id);
}

/** A restored composition may legitimately create its record again. */
export function clearWorkspaceHistorySuppression(id: string) {
  suppressedHistoryIds.delete(id);
}
