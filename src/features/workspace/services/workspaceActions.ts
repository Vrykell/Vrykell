import { editorFileKey } from '@core/editor';
import { newEditorFile } from '@features/editor/services/documentActions';
import { t } from '@i18n';
import { pickPath } from '@platform/api/fs';
import { useToastStore } from '@ui/feedback/Toast';
import { useAiWorkspace, useChatStore } from '@features/chat';
import { useHarnessWorkspace } from '@features/chat/stores/harnessWorkspace';
import { useWorkspaceStore } from '../stores/workspace';
import { orderedWorkspaceIds, useWorkspaceNavigation, workspaceAreaForKind, type WorkspaceArea } from '../stores/navigation';
import { compositionTabs, useUnifiedWorkspace } from '../stores/unifiedWorkspace';
import { activateCompositionTab } from './compositionTabs';
import { workspacePaneCells } from '../model/workspaceResources';
import { createUnifiedResource, createUnifiedTerminal, focusUnifiedResource } from './unifiedWorkspace';

export function sideAiHasFocus(element: Element | null = document.activeElement): boolean {
  return useWorkspaceNavigation.getState().aiPlacement === 'side' && !!element?.closest('[data-testid="ai-surface-side"], [data-workspace-focus="ai"]');
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
  const unified = focusedWorkspaceArea() === 'unified';
  const file = await pickWorkspaceFile();
  if (!file) return;
  useWorkspaceStore.getState().openEditorFile(file);
  if (unified) focusUnifiedResource(`file:${editorFileKey(file)}`);
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
  const workspace = useWorkspaceStore.getState();
  const navigation = useWorkspaceNavigation.getState();
  const area = focusedWorkspaceArea();
  if (area === 'unified') {
    const tab = compositionTabs()[index];
    if (!tab) return false;
    activateCompositionTab(tab.id); return true;
  }
  if (area === 'terminal') {
    const tabs = [...workspace.groups.flatMap(group => workspace.tabs.filter(tab => tab.kind === 'session' && tab.groupId === group.id)),
      ...workspace.tabs.filter(tab => workspaceAreaForKind(tab.kind) === 'terminal' && (tab.kind !== 'session' || !tab.groupId || !workspace.groups.some(group => group.id === tab.groupId)))];
    const tab = tabs[index];
    if (!tab) return false;
    if (tab.kind === 'session' && tab.groupId && workspace.groups.some(group => group.id === tab.groupId && group.collapsed)) workspace.toggleGroupCollapse(tab.groupId);
    workspace.activate(tab.id); return true;
  }
  if (area === 'code') {
    const entries = workspace.tabs.flatMap(tab => {
      if (tab.kind === 'editor') return tab.files.map(file => ({ id: `file:${editorFileKey(file)}`, activate: () => workspace.openEditorFile(file) }));
      if (tab.kind === 'git-diff') return (tab.comparisons ?? [{ id: tab.id, selection: tab.selection }]).map(item => ({ id: `diff:${item.id}`, activate: () => workspace.activateGitComparison(item.id) }));
      return [];
    });
    const id = orderedWorkspaceIds(entries.map(item => item.id), navigation.codeOrder)[index];
    const entry = entries.find(item => item.id === id);
    if (!entry) return false;
    entry.activate(); return true;
  }
  if (area === 'ai') {
    const ai = useAiWorkspace.getState();
    const connections = useHarnessWorkspace.getState();
    const side = sideAiHasFocus();
    const ids = [...ai.nativeTabs.filter(id => useChatStore.getState().conversations.some(item => item.id === id)).map(id => `chat:${id}`),
      ...connections.connections.map(item => `acp:${item.id}`)];
    const id = orderedWorkspaceIds(ids, ai.order)[index];
    if (!id) return false;
    if (side) { ai.selectSide(id); return true; }
    if (id.startsWith('page:')) workspace.activate(id.slice(5));
    else {
      if (!side) ai.select(id);
      if (id.startsWith('chat:')) void useChatStore.getState().selectConversation(id.slice(5)).then(() => {
        if (side) requestAnimationFrame(() => {
          if (useChatStore.getState().activeConversationId !== id.slice(5)) return;
          [...document.querySelectorAll<HTMLTextAreaElement>('[data-testid="ai-surface-side"] [data-chat-composer]')].find(element => element.getClientRects().length > 0 && !element.closest('[inert]'))?.focus({ preventScroll: true });
        });
      }); else connections.select(id.slice(4));
      if (!side) workspace.openHarnessTab();
    }
    return true;
  }
  return false;
}
