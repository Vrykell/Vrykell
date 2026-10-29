import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorFileKey } from '@core/editor';
import { useAiWorkspace } from '@features/chat/stores/aiWorkspace';
import { useChatStore } from '@features/chat/stores/chat';
import { useHarnessWorkspace } from '@features/chat/stores/harnessWorkspace';
import { emptyWorkbench } from '../model/workbench';
import { useWorkspaceStore } from '../stores/workspace';
import { useWorkbenchStore } from '../stores/workbench';
import { useWorkspaceNavigation } from '../stores/navigation';
import { selectWorkspaceArea } from '../services/selectWorkspaceArea';
import { activateContainer, startWorkbenchRuntime } from '../services/workbench';
import { focusUnifiedResource } from '../services/unifiedWorkspace';

vi.mock('@platform/diagnostics', () => ({ invoke: vi.fn(async () => undefined), diagnostic: vi.fn() }));

let dispose: () => void;
beforeEach(() => {
  useWorkspaceStore.setState({ tabs: [], activeId: '', groups: [] });
  useWorkbenchStore.setState({ snapshot: emptyWorkbench(), ready: true });
  useWorkspaceNavigation.setState({ area: 'terminal', lastTabs: {}, aiPlacement: 'main' });
  useAiWorkspace.setState({ nativeTabs: [], selected: '', sideSessions: [], sideSelected: '' });
  useChatStore.setState({ conversations: [], byTab: {} });
  useHarnessWorkspace.setState({ connections: [], selected: '' });
  dispose = startWorkbenchRuntime();
});
afterEach(() => { dispose(); vi.clearAllMocks(); });

it.each(['history', 'ai-history', 'usage'] as const)('restores the selected %s page alongside open content tabs', kind => {
  const workspace = useWorkspaceStore.getState();
  workspace.addTab();
  if (kind !== 'history') {
    useAiWorkspace.getState().openNative(useChatStore.getState().createConversation());
    workspace.openHarnessTab();
  }
  const id = workspace.addTab({ kind });
  const area = useWorkspaceNavigation.getState().area;
  selectWorkspaceArea('ssh');
  selectWorkspaceArea(area);
  expect(useWorkspaceStore.getState().activeId).toBe(id);
  expect(useWorkspaceNavigation.getState().area).toBe(area);
});

it('restores the last file and terminal after viewing different resources in the unified workspace', () => {
  const workspace = useWorkspaceStore.getState();
  const firstTerminal = workspace.addTab();
  const secondTerminal = workspace.addTab();
  activateContainer(firstTerminal);
  const first = { path: '/repo/first.ts' };
  const second = { path: '/repo/second.ts' };
  workspace.openEditorFile(first);
  workspace.openEditorFile(second);
  activateContainer(`file:${editorFileKey(first)}`);
  selectWorkspaceArea('unified');
  focusUnifiedResource(`file:${editorFileKey(second)}`);
  focusUnifiedResource(`terminal:${secondTerminal}#0`);
  const unified = useWorkbenchStore.getState().snapshot.selected.unified;
  selectWorkspaceArea('terminal');
  expect(useWorkspaceStore.getState().activeId).toBe(firstTerminal);
  selectWorkspaceArea('code');
  expect(useWorkspaceStore.getState().tabs.find(tab => tab.kind === 'editor')).toMatchObject({ selected: first });
  selectWorkspaceArea('unified');
  expect(useWorkbenchStore.getState().snapshot.selected.unified).toBe(unified);
  expect(useWorkspaceStore.getState().activeId).toBe(secondTerminal);
});

it('falls back to an open content tab when the remembered utility page has been closed', () => {
  const workspace = useWorkspaceStore.getState();
  const terminal = workspace.addTab();
  const history = workspace.addTab({ kind: 'history' });
  selectWorkspaceArea('ssh');
  useWorkspaceStore.setState(state => ({ tabs: state.tabs.filter(tab => tab.id !== history) }));
  selectWorkspaceArea('terminal');
  expect(useWorkspaceStore.getState().activeId).toBe(terminal);
});

it('keeps the last conversation independent of the conversation viewed in a mixed tab', () => {
  const workspace = useWorkspaceStore.getState();
  workspace.openHarnessTab();
  const first = useChatStore.getState().createConversation();
  const second = useChatStore.getState().createConversation();
  useAiWorkspace.getState().openNative(first);
  useAiWorkspace.getState().openNative(second);
  activateContainer(`chat:${first}`);
  selectWorkspaceArea('unified');
  focusUnifiedResource(`chat:${second}`);
  selectWorkspaceArea('ai');
  expect(useAiWorkspace.getState().selected).toBe(`chat:${first}`);
  selectWorkspaceArea('unified');
  expect(useAiWorkspace.getState().selected).toBe(`chat:${second}`);
});

it('falls back after a remembered content tab closes while another workspace is active', () => {
  const workspace = useWorkspaceStore.getState();
  const first = workspace.addTab();
  const second = workspace.addTab();
  activateContainer(first);
  selectWorkspaceArea('ssh');
  useWorkspaceStore.setState(state => ({ tabs: state.tabs.filter(tab => tab.id !== first) }));
  selectWorkspaceArea('terminal');
  expect(useWorkspaceStore.getState().activeId).toBe(second);
});
