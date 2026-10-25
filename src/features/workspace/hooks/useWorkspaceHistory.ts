import { useEffect, useRef } from 'react';
import { useUnifiedWorkspace } from '../stores/unifiedWorkspace';
import { currentWorkspaceResources } from '../services/workspaceResources';
import { captureWorkspaceHistory, createWorkspaceHistoryWriter } from '../services/workspaceHistory';
import { useToastStore } from '@ui/feedback/Toast';
import { t } from '@i18n';
import { workspacePaneIds } from '../model/workspaceResources';
import type { WorkspaceResource } from '../model/workspaceResources';
import { useHarnessStore } from '@features/chat/stores/harness';
import { useWorkspaceStore } from '../stores/workspace';
import { compositionTabs, type CompositionTab } from '../stores/unifiedWorkspace';

export function useWorkspaceHistory(resources: WorkspaceResource[], store = useUnifiedWorkspace) {
  const agentRevision = useHarnessStore(state => JSON.stringify(Object.entries(state.byTab).map(([id, session]) => [id, session.sessionId])));
  const writer = useRef<ReturnType<typeof createWorkspaceHistoryWriter> | null>(null);
  const compositionSave = useRef<((tab: CompositionTab) => void) | null>(null);
  if (!writer.current) writer.current = createWorkspaceHistoryWriter(error => useToastStore.getState().addToast(t('Could not save workspace history: {{error}}', { error: String(error) }), 'error'), historyIdentity => store.setState({ historyIdentity }));
  useEffect(() => {
    if (store === useUnifiedWorkspace) {
      const writers = new Map<string, ReturnType<typeof createWorkspaceHistoryWriter>>();
      const timers = new Map<string, ReturnType<typeof setTimeout>>();
      const save = (tab: CompositionTab) => {
        let write = writers.get(tab.id);
        if (!write) {
          write = createWorkspaceHistoryWriter(error => useToastStore.getState().addToast(t('Could not save workspace history: {{error}}', { error: String(error) }), 'error'), historyIdentity => {
            useWorkspaceStore.setState(state => ({ tabs: state.tabs.map(item => item.id === tab.id && item.kind === 'workspace' ? { ...item, historyIdentity } : item) }));
          });
          writers.set(tab.id, write);
        }
        void write(captureWorkspaceHistory(tab.paneLayout, tab.focusedPane, currentWorkspaceResources()), tab.historyIdentity,
          tab.titleSource === 'manual' ? tab.title : undefined);
      };
      compositionSave.current = save;
      for (const tab of compositionTabs()) save(tab);
      const unsubscribe = useWorkspaceStore.subscribe((state, previous) => {
        if (state.tabs === previous.tabs) return;
        for (const tab of compositionTabs()) {
          const before = previous.tabs.find(item => item.id === tab.id);
          if (before === tab) continue;
          clearTimeout(timers.get(tab.id));
          const beforeIds = before?.kind === 'workspace' && before.paneLayout ? workspacePaneIds(before.paneLayout) : [];
          const nextIds = tab.paneLayout ? workspacePaneIds(tab.paneLayout) : [];
          if (JSON.stringify(beforeIds.sort()) !== JSON.stringify(nextIds.sort())) save(tab);
          else timers.set(tab.id, setTimeout(() => { save(tab); timers.delete(tab.id); }, 200));
        }
        for (const tab of previous.tabs) if (tab.kind === 'workspace' && !state.tabs.some(item => item.id === tab.id)) {
          clearTimeout(timers.get(tab.id)); timers.delete(tab.id); save(tab);
        }
      });
      return () => { unsubscribe(); compositionSave.current = null; for (const timer of timers.values()) clearTimeout(timer); };
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    let previous = '';
    const save = () => {
      const state = store.getState();
      return writer.current!(captureWorkspaceHistory(state.layout, state.focused, currentWorkspaceResources()), state.historyIdentity);
    };
    const unsubscribe = store.subscribe((state, before) => {
      if (state.layout === before.layout && state.focused === before.focused) return;
      const signature = state.layout ? JSON.stringify(workspacePaneIds(state.layout).sort()) : '';
      clearTimeout(timer);
      if (signature !== previous) { previous = signature; void save(); }
      else timer = setTimeout(() => { void save(); }, 200);
    });
    return () => { unsubscribe(); clearTimeout(timer); };
  }, [store]);
  useEffect(() => {
    if (store === useUnifiedWorkspace) { for (const tab of compositionTabs()) compositionSave.current?.(tab); return; }
    const state = store.getState();
    void writer.current!(captureWorkspaceHistory(state.layout, state.focused, resources), state.historyIdentity);
  }, [resources, agentRevision, store]);
}
