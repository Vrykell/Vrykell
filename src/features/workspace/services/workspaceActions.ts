import { editorFileKey } from '@core/editor';
import { newEditorFile } from '@features/editor/services/documentActions';
import { t } from '@i18n';
import { pickPath } from '@platform/api/fs';
import { useToastStore } from '@ui/feedback/Toast';
import { useAiWorkspace, useChatStore } from '@features/chat';
import { availableSideConversationIds } from '@features/chat/services/aiWorkspace';
import { useWorkspaceStore } from '../stores/workspace';
import { useWorkspaceNavigation, workspaceAreaForKind, type WorkspaceArea } from '../stores/navigation';
import { useUnifiedWorkspace } from '../stores/unifiedWorkspace';
import { workspacePaneCells } from '../model/workspaceResources';
import { createUnifiedResource, createUnifiedTerminal, presentWorkspaceResource } from './unifiedWorkspace';
import { useWorkbenchStore } from '../stores/workbench';
import { activateContainer, synchronizeWorkbench } from './workbench';
import { workspaceStripEntities } from '../model/workbench';

export function sideAiHasFocus(element: Element | null = document.activeElement): boolean {
  return !!element?.closest('[data-testid="ai-surface-side"], [data-workspace-focus="ai-side"]');
}

export function focusedWorkspaceArea(): WorkspaceArea {
  return sideAiHasFocus() ? 'ai' : useWorkspaceNavigation.getState().area;
}

export async function pickWorkspaceFile() {
  try {
    const [path] = await pickPath('file');
    return path ? { path } : null;
  } catch (reason) { useToastStore.getState().addToast(t('Could not open file: {{error}}', { error: String(reason) }), 'error'); }
  return null;
}

export async function openWorkspaceFile() {
  const file = await pickWorkspaceFile();
  if (!file) return;
  useWorkspaceStore.getState().openEditorFile(file);
  presentWorkspaceResource(`file:${editorFileKey(file)}`);
}

/** An explicit settings action starts a dedicated, normally authorized memory review. */
export function organizeMemoryWithAssistant() {
  const chat = useChatStore.getState();
  const id = chat.createConversation();
  chat.renameConversation(id, t('Memory review'));
  useAiWorkspace.getState().openNative(id);
  useWorkspaceNavigation.getState().selectArea('ai');
  useWorkspaceStore.getState().openHarnessTab();
  void chat.send(t('Review my saved memories, including pending and expired records, using the memory tool. Organize duplicates and outdated facts, and ask me before activating facts that cannot be verified. Do not assume old records are still correct.'), { conversationId: id });
}

export function newWorkspaceItem() {
  const area = focusedWorkspaceArea();
  if (area === 'unified') {
    const state = useUnifiedWorkspace.getState();
    const id = state.layout && workspacePaneCells(state.layout).find(cell => cell.id === state.focused)?.resourceId;
    if (id?.startsWith('chat:') || id?.startsWith('acp:')) createUnifiedResource('conversation');
    else if (id?.startsWith('terminal:') || !id) createUnifiedTerminal();
    else createUnifiedResource('document');
    return;
  }
  if (area === 'terminal') useWorkspaceStore.getState().addTab();
  else if (area === 'code') newEditorFile();
  else if (area === 'ai') {
    const side = sideAiHasFocus();
    const id = useChatStore.getState().createConversation(null, { activate: !side });
    if (side) useAiWorkspace.getState().selectSide(`chat:${id}`);
    else useAiWorkspace.getState().openNative(id);
    if (!side) useWorkspaceStore.getState().openHarnessTab();
  }
}

/** Numeric selection follows the displayed group and mixed-document order. */
export function activateWorkspaceInstance(index: number): boolean {
  const area = focusedWorkspaceArea();
  if (!sideAiHasFocus() && (area === 'terminal' || area === 'code' || area === 'ai' || area === 'unified')) {
    synchronizeWorkbench();
    const state = useWorkbenchStore.getState().snapshot;
    const tabs = state.tabs.filter(tab => tab.scope === area && tab.layout);
    const pages = area === 'ai' && useWorkspaceNavigation.getState().aiPlacement === 'side' ? [] : useWorkspaceStore.getState().tabs.filter(tab => workspaceAreaForKind(tab.kind) === area && ['history', 'ai-history', 'usage', 'start', 'start-code', 'start-ai'].includes(tab.kind));
    const utilityId = (id: string) => area === 'ai' ? `page:${id}` : id;
    const ordered = workspaceStripEntities(state, area, pages.map(page => utilityId(page.id))).flatMap(entity => entity.startsWith('group:') ? tabs.filter(tab => tab.groupId === entity.slice(6)).map(tab => tab.id) : [entity.slice(4)]);
    const id = ordered[index];
    const tab = tabs.find(tab => tab.id === id);
    if (tab) { activateContainer(tab.id); return true; }
    const page = pages.find(page => utilityId(page.id) === id);
    if (page) { useWorkspaceStore.getState().activate(page.id); return true; }
    return false;
  }
  if (area !== 'ai') return false;
  const ai = useAiWorkspace.getState();
  const available = availableSideConversationIds();
  const ids = [...available];
  const id = ids[index]; if (!id) return false;
  ai.selectSide(id);
  requestAnimationFrame(() => {
    if (useAiWorkspace.getState().sideSelected !== id) return;
    [...document.querySelectorAll<HTMLTextAreaElement>('[data-testid="ai-surface-side"] [data-chat-composer]')]
      .find(element => element.getClientRects().length > 0 && !element.closest('[inert]'))?.focus({ preventScroll: true });
  });
  return true;
}
