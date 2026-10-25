import { beforeEach, expect, it, vi } from 'vitest';
import { createSideAgent, createSideConversation } from '../services/aiWorkspace';
import { useAiWorkspace } from '../stores/aiWorkspace';
import { useChatStore } from '../stores/chat';
import { useHarnessWorkspace } from '../stores/harnessWorkspace';
import { useWorkspaceStore } from '@features/workspace/stores/workspace';
import { useWorkspaceNavigation } from '@features/workspace/stores/navigation';

vi.mock('@platform/diagnostics', () => ({ invoke: vi.fn(async () => undefined), diagnostic: vi.fn() }));
beforeEach(() => {
  useWorkspaceStore.setState({ tabs: [], activeId: 'main' });
  useWorkspaceNavigation.setState({ area: 'terminal', aiPlacement: 'side' });
  useAiWorkspace.setState({ nativeTabs: [], selected: 'chat:main', sideSelected: '' });
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
