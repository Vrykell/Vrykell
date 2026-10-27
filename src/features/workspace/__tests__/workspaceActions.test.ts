import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('@platform/diagnostics', () => ({ invoke: vi.fn(async () => undefined), diagnostic: vi.fn() }));
vi.mock('@platform/api/fs', async original => ({ ...await original<typeof import('@platform/api/fs')>(), pickPath: vi.fn() }));
import { pickPath } from '@platform/api/fs';
import { editorFileKey } from '@core/editor';
import { useWorkspaceStore } from '../stores/workspace';
import { useWorkspaceNavigation } from '../stores/navigation';
import { useAiWorkspace, useChatStore } from '@features/chat';
import { activateWorkspaceInstance, focusedWorkspaceArea, newWorkspaceItem, openWorkspaceFile, organizeMemoryWithAssistant } from '../services/workspaceActions';
import { closeWorkspaceItem } from '../services/closeWorkspaceItem';
import { synchronizeWorkbench } from '../services/workbench';
import { useWorkbenchStore } from '../stores/workbench';

const snapshot = useWorkspaceStore.getState();
beforeEach(() => {
  useWorkspaceStore.setState({ tabs: [], activeId: '', groups: [] });
  useWorkspaceNavigation.setState({ area: 'terminal', collapsed: false, aiPlacement: 'main' });
  useAiWorkspace.setState({ nativeTabs: [], selected: '', sideSelected: '', sideSessions: [] });
});
afterEach(() => { useWorkspaceStore.setState(snapshot, true); document.body.replaceChildren(); vi.clearAllMocks(); });

it('starts memory review in its own briefly named conversation through the normal send path', () => {
  const send = vi.spyOn(useChatStore.getState(), 'send').mockResolvedValue(undefined);
  try {
    organizeMemoryWithAssistant();
    const id = useAiWorkspace.getState().selected.slice(5);
    expect(useWorkspaceNavigation.getState().area).toBe('ai');
    expect(useChatStore.getState().conversations.find(item => item.id === id)?.title).toBe('记忆整理');
    expect(send).toHaveBeenCalledWith(expect.stringContaining('待确认'), { conversationId: id });
  } finally { send.mockRestore(); }
});

it('restores composer focus after a numeric shortcut switches the side conversation', () => {
  useWorkspaceNavigation.setState({ area: 'terminal', aiPlacement: 'side' });
  const first = useChatStore.getState().createConversation();
  const second = useChatStore.getState().createConversation();
  useAiWorkspace.setState({ nativeTabs: [first, second], sideSelected: `chat:${first}`, sideSessions: [`chat:${first}`, `chat:${second}`] });
  const surface = document.createElement('div'); surface.dataset.testid = 'ai-surface-side';
  const previous = document.createElement('textarea'); previous.dataset.chatComposer = 'true';
  surface.append(previous); document.body.append(surface); previous.focus();
  let frame!: FrameRequestCallback;
  const raf = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(callback => { frame = callback; return 1; });
  const next = document.createElement('textarea'); next.dataset.chatComposer = 'true';
  const rects = vi.spyOn(next, 'getClientRects').mockReturnValue([new DOMRect(0, 0, 100, 30)] as unknown as DOMRectList);
  try {
    expect(activateWorkspaceInstance(1)).toBe(true);
    previous.remove(); surface.append(next);
    frame(0);
    expect(next).toHaveFocus();
    expect(focusedWorkspaceArea()).toBe('ai');
    expect(activateWorkspaceInstance(0)).toBe(true);
    expect(useAiWorkspace.getState().sideSelected).toBe(`chat:${first}`);
  } finally { raf.mockRestore(); rects.mockRestore(); }
});

it('opens a selected file in the code workspace and leaves a cancelled picker untouched', async () => {
  vi.mocked(pickPath).mockResolvedValueOnce([]);
  await openWorkspaceFile(); expect(useWorkspaceStore.getState().tabs).toEqual([]);
  vi.mocked(pickPath).mockResolvedValueOnce(['/repo/file.ts']);
  await openWorkspaceFile();
  expect(useWorkspaceStore.getState().tabs[0]).toMatchObject({ kind: 'editor', selected: { path: '/repo/file.ts' } });
  expect(useWorkspaceNavigation.getState().area).toBe('code');
});

it('creates an untitled document directly without opening a picker', () => {
  useWorkspaceNavigation.setState({ area: 'code' }); newWorkspaceItem();
  const page = useWorkspaceStore.getState().tabs[0];
  expect(page).toMatchObject({ kind: 'editor', selected: { path: '未命名 1.txt', draftId: expect.any(String) } });
  expect(pickPath).not.toHaveBeenCalled();
});
it('selects files and comparisons using their mixed strip order', () => {
  const state = useWorkspaceStore.getState();
  const file = { path: '/repo/file.ts' };
  state.openEditorFile(file);
  state.openGitDiff({ paneId: 'terminal', target: { cwd: '/repo' }, path: 'file.ts', scope: 'unstaged' });
  const comparison = useWorkspaceStore.getState().tabs.find(tab => tab.kind === 'git-diff')!;
  if (comparison.kind !== 'git-diff') throw new Error('Expected comparison');
  const id = comparison.comparisons?.[0].id ?? comparison.id;
  synchronizeWorkbench(); useWorkbenchStore.getState().update(state => ({ ...state, order: { code: [`tab:diff:${id}`, `tab:file:${editorFileKey(file)}`] } }));
  expect(activateWorkspaceInstance(1)).toBe(true);
  expect(useWorkspaceStore.getState().tabs.find(tab => tab.id === useWorkspaceStore.getState().activeId)?.kind).toBe('editor');
  expect(activateWorkspaceInstance(0)).toBe(true);
  expect(useWorkspaceStore.getState().activeId).toBe(comparison.id);
  expect(activateWorkspaceInstance(8)).toBe(false);
});
it('selects terminal groups in visual order and expands the selected collapsed group', async () => {
  useWorkspaceStore.setState({ tabs: [
    { id: 'loose', kind: 'session', title: 'Loose', layout: { type: 'leaf', terminal: { id: 'loose#0', kind: 'local' } } },
    { id: 'grouped', kind: 'session', title: 'Grouped', groupId: 'group', layout: { type: 'leaf', terminal: { id: 'grouped#0', kind: 'local' } } },
  ], activeId: 'loose', groups: [{ id: 'group', title: 'Group', collapsed: true }] });
  expect(activateWorkspaceInstance(0)).toBe(true);
  expect(useWorkspaceStore.getState().activeId).toBe('grouped');
  await vi.waitFor(() => expect(useWorkspaceStore.getState().groups[0].collapsed).toBe(false));
});
it('creates AI conversations in the focused side surface without replacing the main workspace', () => {
  useWorkspaceNavigation.setState({ area: 'terminal', aiPlacement: 'side' });
  const surface = document.createElement('div'); surface.dataset.testid = 'ai-surface-side';
  const input = document.createElement('input'); surface.appendChild(input); document.body.appendChild(surface); input.focus();
  expect(focusedWorkspaceArea()).toBe('ai');
  const previous = useChatStore.getState().activeConversationId;
  newWorkspaceItem();
  expect(useWorkspaceNavigation.getState().area).toBe('terminal');
  expect(useAiWorkspace.getState().nativeTabs).toEqual([useAiWorkspace.getState().sideSelected.slice(5)]);
  expect(useChatStore.getState().activeConversationId).toBe(previous);
  expect(useWorkspaceStore.getState().tabs).toEqual([]);
});

it('keeps a portaled conversation settings field in the side conversation keyboard scope', () => {
  useWorkspaceNavigation.setState({ area: 'terminal', aiPlacement: 'side' });
  const menu = document.createElement('section'); menu.dataset.workspaceFocus = 'ai-side';
  const field = document.createElement('button'); menu.appendChild(field); document.body.appendChild(menu); field.focus();
  expect(focusedWorkspaceArea()).toBe('ai');
  newWorkspaceItem();
  expect(useWorkspaceStore.getState().tabs).toEqual([]);
  expect(useWorkspaceNavigation.getState().area).toBe('terminal');
});

it('keeps hidden AI pages out of numeric tab navigation while a native chat is docked', () => {
  const workspace = useWorkspaceStore.getState();
  workspace.openHarnessTab();
  useAiWorkspace.getState().openNative(useChatStore.getState().createConversation());
  workspace.openUsageTab(); workspace.openAiHistoryTab();
  useWorkspaceNavigation.setState({ aiPlacement: 'side' });
  expect(activateWorkspaceInstance(1)).toBe(false);
  expect(useWorkspaceStore.getState().tabs.find(tab => tab.id === useWorkspaceStore.getState().activeId)?.kind).toBe('ai-history');
  expect(useWorkspaceNavigation.getState().aiPlacement).toBe('side');
  expect(activateWorkspaceInstance(3)).toBe(false);
  const harness = useWorkspaceStore.getState().tabs.find(tab => tab.kind === 'harness')!;
  useWorkspaceStore.getState().activate(harness.id);
  closeWorkspaceItem();
  expect(useAiWorkspace.getState().nativeTabs).toHaveLength(0);
});
