import { t } from '@i18n';
import { useWorkspaceStore } from '@features/workspace/stores/workspace';
import { leaves } from '@features/workspace/model/windowLayout';
import { useDockStore } from '@features/workspace/stores/dock';
import { useTerminalStore, useBlockStore, getRecentOutputFor } from '@features/terminal';
import { focusSessionInput } from '@features/terminal/services/terminalFocus';
import { shellTypeLabel } from '@platform/shells';
import { useChatStore } from '../stores/chat';
import { useComposerDrafts } from '../stores/composerDrafts';
import { useAiWorkspace } from '../stores/aiWorkspace';
import type { ChatEnvironment, TerminalReference } from '../model/conversation';
import { useSshStore } from '@features/ssh';

export function environmentForPane(paneId: string): ChatEnvironment | null {
  const workspace = useWorkspaceStore.getState();
  for (const tab of workspace.tabs) {
    if (tab.kind !== 'session') continue;
    const panes = leaves(tab.layout);
    const pane = panes.find(item => item.id === paneId);
    if (!pane) continue;
    const name = pane.kind === 'ssh' ? pane.ssh?.name || pane.ssh?.host || 'SSH' : pane.shellType ? shellTypeLabel(pane.shellType) : t('Local terminal');
    const splitLabel = panes.length > 1 ? ` · ${t('Pane {{number}}', { number: panes.indexOf(pane) + 1 })}` : '';
    return { paneId, kind: pane.kind, label: `${tab.title} · ${name}${splitLabel}`, cwd: workspace.terminalCwds[paneId] ?? pane.cwd,
      ...(pane.shellType ? { shellType: pane.shellType } : {}),
      ...(pane.kind === 'ssh' && pane.ssh ? { ssh: { host: pane.ssh.host, user: pane.ssh.user, port: pane.ssh.port },
        aiNotes: useSshStore.getState().connections.find(connection => connection.id === pane.ssh?.connectionId)?.aiNotes ?? pane.ssh.aiNotes } : {}),
    };
  }
  return null;
}

export function showExecutionTerminal(paneId: string): void {
  const workspace = useWorkspaceStore.getState();
  const tab = workspace.tabs.find(item => item.kind === 'session' && leaves(item.layout).some(pane => pane.id === paneId));
  if (!tab) return;
  workspace.activate(tab.id);
  useTerminalStore.getState().setFocusedPane(paneId);
  window.requestAnimationFrame(() => {
    if (useWorkspaceStore.getState().activeId === tab.id) focusSessionInput(paneId);
  });
}

/** Bring a snapshot into a compatible conversation without submitting or granting terminal access. */
export function askAboutTerminal(paneId: string, reference?: TerminalReference, text?: string): string {
  const chat = useChatStore.getState();
  const environment = environmentForPane(paneId);
  if (!reference && !text) {
    const block = useBlockStore.getState().byTab[paneId]?.slice().reverse().find(item => !!item.command || !!item.outputText);
    const output = block?.outputText || getRecentOutputFor(paneId);
    if (block || output) reference = {
      id: block?.id ?? `snapshot-${paneId}-${Date.now()}`, paneId, label: environment?.label ?? t('Terminal output'),
      command: block?.command ?? '', output, cwd: block?.cwd ?? environment?.cwd,
      exitCode: block?.exitCode, createdAt: block?.startedAt ?? Date.now(),
    };
  }
  const current = chat.conversations.find(item => item.id === chat.activeConversationId);
  const id = current && (!current.environment || current.environment.paneId === paneId)
    ? current.id : chat.createConversation();
  void chat.selectConversation(id);
  useAiWorkspace.getState().openNative(id);
  const drafts = useComposerDrafts.getState();
  if (reference) {
    const previous = drafts.byTab[id]?.references ?? [];
    drafts.setReferences(id, [...previous.filter(item => item.id !== reference.id), { ...reference, label: environment?.label ?? reference.label }]);
  }
  if (text) {
    const previous = drafts.byTab[id]?.text;
    drafts.setText(id, previous ? `${previous}\n${text}` : text);
  }
  useDockStore.getState().openPanel('chat');
  return id;
}
