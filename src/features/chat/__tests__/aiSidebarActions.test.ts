import { beforeEach, expect, it, vi } from 'vitest';
import { availableSideConversationIds, createSideAgent, createSideConversation, moveMainConversationToSide, moveSideConversationToMain } from '../services/aiWorkspace';
import { useAiWorkspace } from '../stores/aiWorkspace';
import { useChatStore } from '../stores/chat';
import { useHarnessWorkspace } from '../stores/harnessWorkspace';
import { useWorkspaceStore } from '@features/workspace/stores/workspace';
import { useWorkspaceNavigation } from '@features/workspace/stores/navigation';
import { scopedPaneStores } from '@features/workspace/stores/scopedPanes';
import { workspacePaneCells } from '@features/workspace/model/workspaceResources';
import { useDockStore } from '@features/workspace/stores/dock';

vi.mock('@platform/diagnostics', () => ({ invoke: vi.fn(async () => undefined), diagnostic: vi.fn() }));
beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { value: 1240, configurable: true });
  useDockStore.setState({ leftZone: [], leftPanels: [], rightPanels: [], collapsedPanels: [] });
  scopedPaneStores.ai.setState({ layout: null, choosingSplit: false });
  useWorkspaceStore.setState({ tabs: [], activeId: 'main' });
  useWorkspaceNavigation.setState({ area: 'terminal', aiPlacement: 'side' });
  useAiWorkspace.setState({ nativeTabs: [], selected: 'chat:main', sideSelected: '', sideSessions: [] });
  useChatStore.setState({ conversations: [], activeConversationId: 'main', byTab: {} });
  useHarnessWorkspace.setState({ connections: [], selected: '' });
});

it('creates native and external conversations without replacing the main selection or navigation', () => {
  const native = createSideConversation();
  expect(useAiWorkspace.getState().sideSelected).toBe(`chat:${native}`);
  expect(useChatStore.getState().activeConversationId).toBe('main');
  const agent = createSideAgent('Agent', '/project');
  expect(useAiWorkspace.getState().sideSelected).toBe(`acp:${agent}`);
  expect(useAiWorkspace.getState().selected).toBe('chat:main');
  expect(useHarnessWorkspace.getState().connections[0]).toMatchObject({ cwd: '/project', fresh: true });
  expect(useWorkspaceNavigation.getState()).toMatchObject({ area: 'terminal', aiPlacement: 'side' });
  expect(useWorkspaceStore.getState().tabs).toHaveLength(0);
});

it('keeps previous side conversations assigned to the sidebar until explicitly moved', () => {
  const first = createSideConversation(); const second = createSideConversation();
  expect(availableSideConversationIds()).toEqual(new Set([`chat:${first}`, `chat:${second}`]));
  useAiWorkspace.getState().openNative(first);
  expect(availableSideConversationIds()).toEqual(new Set([`chat:${second}`]));
  expect(useAiWorkspace.getState().sideSelected).toBe(`chat:${second}`);
  expect(useAiWorkspace.getState().sideSessions).toEqual([`chat:${second}`]);
});

it('moves the selected side conversation into the AI workspace when the current area is native', () => {
  const id = createSideConversation();
  moveSideConversationToMain();
  expect(useWorkspaceNavigation.getState().area).toBe('ai');
  expect(useAiWorkspace.getState().nativeTabs).toContain(id);
  expect(useAiWorkspace.getState().sideSelected).toBe('');
});

it('detaches only the explicitly moved conversation from a main split', () => {
  const first = useChatStore.getState().createConversation(); const second = useChatStore.getState().createConversation();
  useAiWorkspace.setState({ nativeTabs: [first, second], selected: `chat:${second}` });
  scopedPaneStores.ai.getState().restore({ type: 'split', direction: 'row', ratio: 0.5,
    first: { type: 'pane', id: 'first', resourceId: `chat:${first}` }, second: { type: 'pane', id: 'second', resourceId: `chat:${second}` } }, 'second');
  moveMainConversationToSide(`chat:${second}`);
  expect(workspacePaneCells(scopedPaneStores.ai.getState().layout!)).toHaveLength(1);
  expect(workspacePaneCells(scopedPaneStores.ai.getState().layout!)[0].resourceId).toBe(`chat:${first}`);
  expect(availableSideConversationIds()).toEqual(new Set([`chat:${second}`]));
});

it('keeps the selected main conversation in place when the dock has no room', () => {
  Object.defineProperty(window, 'innerWidth', { value: 500, configurable: true });
  const id = useChatStore.getState().createConversation();
  useAiWorkspace.setState({ nativeTabs: [id], selected: `chat:${id}` });
  expect(moveMainConversationToSide(`chat:${id}`)).toBe(false);
  expect(useAiWorkspace.getState()).toMatchObject({ selected: `chat:${id}`, sideSelected: '' });
});
