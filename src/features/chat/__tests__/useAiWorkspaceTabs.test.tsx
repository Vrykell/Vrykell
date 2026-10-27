import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useSessionStore } from '@features/workspace/model/session/store';
import { useHarnessWorkspace } from '../stores/harnessWorkspace';
import { useAiWorkspace } from '../stores/aiWorkspace';
import { useChatStore } from '../stores/chat';
import { useAiWorkspaceTabs } from '../hooks/useAiWorkspaceTabs';
import { closeAiWorkspaceSession } from '../services/aiWorkspace';
import { useWorkbenchStore } from '@features/workspace/stores/workbench';
import { workspaceStripEntities } from '@features/workspace/model/workbench';

vi.mock('../services/aiWorkspace', () => ({ closeAiWorkspaceSession: vi.fn() }));

const conversations = [
  { id: 'c1', title: 'Investigation', createdAt: 1, updatedAt: 1, environment: null },
  { id: 'c2', title: 'Docked', createdAt: 2, updatedAt: 2, environment: null },
];
const openHarnessTab = vi.fn();
const activate = vi.fn();
const closeTab = vi.fn();
const selectConversation = vi.fn().mockResolvedValue(undefined);
const selectConnection = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  useSessionStore.setState({
    tabs: [
      { id: 'usage', title: 'Usage', kind: 'usage' },
      { id: 'history', title: 'History', kind: 'ai-history' },
      { id: 'start-ai', title: 'Assistant', kind: 'start-ai' },
      { id: 'terminal', title: 'Terminal', kind: 'session', layout: { type: 'leaf', terminal: { id: 't#0', kind: 'local' } } },
    ],
    activeId: 'usage',
    openHarnessTab,
    activate,
    closeTab,
  });
  useHarnessWorkspace.setState({
    connections: [{ id: 'agent-1', harness: 'Agent', cwd: '/repo', fresh: false }],
    select: selectConnection,
  });
  useAiWorkspace.setState({ nativeTabs: ['c1', 'c2'], selected: '', sideSelected: '', sideSessions: [] });
  useChatStore.setState({ conversations, selectConversation });
});

it('projects the visible AI strip and routes conversation selection', () => {
  const { result } = renderHook(() => useAiWorkspaceTabs());
  expect(result.current.handles.map(handle => handle.id)).toEqual([
    'chat:c1', 'chat:c2', 'acp:agent-1', 'page:usage', 'page:history', 'page:start-ai',
  ]);
  act(() => result.current.onSelect('chat:c1'));
  expect(openHarnessTab).toHaveBeenCalledOnce();
  expect(useAiWorkspace.getState().selected).toBe('chat:c1');
  expect(selectConversation).toHaveBeenCalledWith('c1');
});

it('routes agent and system-page selection without opening a harness page twice', () => {
  useSessionStore.setState({ activeId: 'terminal' });
  const { result } = renderHook(() => useAiWorkspaceTabs());
  act(() => result.current.onSelect('acp:agent-1'));
  expect(selectConnection).toHaveBeenCalledWith('agent-1');
  act(() => result.current.onSelect('page:usage'));
  expect(activate).toHaveBeenCalledWith('usage');
});

it('routes close to the owning page or session lifecycle', () => {
  const { result } = renderHook(() => useAiWorkspaceTabs());
  act(() => result.current.onClose('page:usage'));
  expect(closeTab).toHaveBeenCalledWith('usage');
  act(() => result.current.onClose('chat:c1'));
  expect(closeAiWorkspaceSession).toHaveBeenCalledWith('chat:c1', true);
});

it('moves only the rows currently visible in the strip', () => {
  useAiWorkspace.setState({ nativeTabs: ['c1'], sideSelected: 'chat:c2' });
  const { result } = renderHook(() => useAiWorkspaceTabs());
  act(() => result.current.onMove('acp:agent-1', 'chat:c1', false));
  expect(workspaceStripEntities(useWorkbenchStore.getState().snapshot, 'ai')).toEqual(['tab:acp:agent-1', 'tab:chat:c1']);
});
