import { useMemo } from 'react';
import { useSessionStore } from '@features/workspace';
import type { WorkspaceTabStrip } from '@features/workspace/model/tabStrip';
import { useChatStore } from '../stores/chat';
import { useHarnessWorkspace } from '../stores/harnessWorkspace';
import { useAiWorkspace } from '../stores/aiWorkspace';
import { projectAiTabs } from '../model/aiTabHandles';
import { closeAiWorkspaceSession } from '../services/aiWorkspace';

/**
 * One projection for every row the AI workspace can show.
 *
 * Conversations, ACP connections and system pages stay in their own stores; the strip only
 * receives the ordered handles and the three lifecycle callbacks.
 */
export function useAiWorkspaceTabs(): WorkspaceTabStrip {
  const connections = useHarnessWorkspace(state => state.connections);
  const nativeTabs = useAiWorkspace(state => state.nativeTabs);
  const sideSelected = useAiWorkspace(state => state.sideSelected);
  const sideSessions = useAiWorkspace(state => state.sideSessions);
  const order = useAiWorkspace(state => state.order);
  const conversations = useChatStore(state => state.conversations);
  const pages = useSessionStore(state => state.tabs);
  const activePageId = useSessionStore(state => state.activeId);
  const activePage = pages.find(page => page.id === activePageId);

  const targets = useMemo(() => projectAiTabs({
    nativeTabs,
    conversations,
    connections,
    systemPages: pages.filter(page => page.kind === 'ai-history' || page.kind === 'usage' || page.kind === 'start-ai'),
    sideSelected,
    sideSessions,
    order,
  }), [nativeTabs, conversations, connections, pages, sideSelected, sideSessions, order]);

  return {
    handles: targets.map(item => item.handle),
    onSelect: id => {
      if (id.startsWith('page:')) { useSessionStore.getState().activate(id.slice(5)); return; }
      if (activePage?.kind !== 'harness' || id.startsWith('chat:')) useSessionStore.getState().openHarnessTab();
      useAiWorkspace.getState().select(id);
      if (id.startsWith('chat:')) void useChatStore.getState().selectConversation(id.slice(5));
      else useHarnessWorkspace.getState().select(id.slice(4));
    },
    onClose: id => {
      if (id.startsWith('page:')) useSessionStore.getState().closeTab(id.slice(5));
      else closeAiWorkspaceSession(id);
    },
    onMove: (id, over, after) => useAiWorkspace.getState().move(targets.map(item => item.handle.id), id, over, after),
  };
}
