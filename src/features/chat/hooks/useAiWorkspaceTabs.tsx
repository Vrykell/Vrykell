import { useMemo } from 'react';
import { useSessionStore } from '@features/workspace';
import { useWorkspaceContainerTabs } from '@features/workspace/hooks/useWorkspaceContainerTabs';
import { useChatStore } from '../stores/chat';
import { useHarnessWorkspace } from '../stores/harnessWorkspace';
import { useAiWorkspace } from '../stores/aiWorkspace';
import { projectAiTabs } from '../model/aiTabHandles';

/** Conversations and agent connections supply resources to layout-owning tabs. */
export function useAiWorkspaceTabs() {
  const connections = useHarnessWorkspace(state => state.connections);
  const nativeTabs = useAiWorkspace(state => state.nativeTabs);
  const selected = useAiWorkspace(state => state.selected);
  const sideSelected = useAiWorkspace(state => state.sideSelected);
  const sideSessions = useAiWorkspace(state => state.sideSessions);
  const conversations = useChatStore(state => state.conversations);
  const pages = useSessionStore(state => state.tabs);
  const activePageId = useSessionStore(state => state.activeId);
  const targets = useMemo(() => projectAiTabs({ nativeTabs, conversations, connections,
    systemPages: pages.filter(page => page.kind === 'ai-history' || page.kind === 'usage' || page.kind === 'start-ai'),
    sideSelected, sideSessions,
  }), [nativeTabs, conversations, connections, pages, sideSelected, sideSessions]);
  const system = targets.filter(target => target.kind === 'page');
  const containers = useWorkspaceContainerTabs('ai', targets.filter(target => target.kind !== 'page').map(target => target.handle), selected, system.map(target => target.handle.id));
  const active = system.find(target => target.pageId === activePageId);
  return { ...containers, handles: [...containers.handles, ...system.map(target => target.handle)],
    selected: active?.handle.id ?? containers.selected,
    onSelect: (id: string) => { const page = system.find(target => target.handle.id === id); if (page) useSessionStore.getState().activate(page.pageId); else containers.onSelect(id); },
    onClose: (id: string) => { const page = system.find(target => target.handle.id === id); if (page) useSessionStore.getState().closeTab(page.pageId); else containers.onClose(id); },
  };
}
