import { afterEach, expect, it } from 'vitest';
import { useWorkspaceStore } from '../stores/workspace';
import { useWorkspaceNavigation } from '../stores/navigation';
import { useAiWorkspace } from '@features/chat/stores/aiWorkspace';
import { useChatStore } from '@features/chat/stores/chat';
import { useHarnessWorkspace } from '@features/chat/stores/harnessWorkspace';

const originals = [useWorkspaceStore.getState(), useWorkspaceNavigation.getState(), useAiWorkspace.getState(), useChatStore.getState(), useHarnessWorkspace.getState()] as const;
afterEach(() => {
  useWorkspaceStore.setState(originals[0], true); useWorkspaceNavigation.setState(originals[1], true);
  useAiWorkspace.setState(originals[2], true); useChatStore.setState(originals[3], true); useHarnessWorkspace.setState(originals[4], true);
});

it('shows the main AI start tab when the only conversations belong to the sidebar', () => {
  useWorkspaceStore.setState({ tabs: [], activeId: '' }); useWorkspaceNavigation.setState({ area: 'ai' });
  useChatStore.setState({ conversations: [{ id: 'side', title: 'Side conversation', createdAt: 1, updatedAt: 1, environment: null }] });
  useAiWorkspace.setState({ nativeTabs: ['side', 'missing'], selected: '', sideSelected: 'chat:side', sideSessions: ['chat:side', 'acp:agent'] });
  useHarnessWorkspace.setState({ connections: [{ id: 'agent', harness: 'Agent', cwd: '', fresh: false }] });
  useWorkspaceStore.getState().ensureStartPages();
  const starts = useWorkspaceStore.getState().tabs.filter(tab => tab.kind === 'start-ai');
  expect(starts).toHaveLength(1);
  expect(useWorkspaceStore.getState().activeId).toBe(starts[0]!.id);
});
