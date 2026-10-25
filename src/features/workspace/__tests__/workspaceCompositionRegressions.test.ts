import { beforeEach, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from '../stores/workspace';
import { useWorkspaceNavigation } from '../stores/navigation';
import { useUnifiedWorkspace } from '../stores/unifiedWorkspace';
import { workspacePaneCells } from '../model/workspaceResources';
import { requestWorkspaceSplit } from '../services/unifiedWorkspace';
import { scopedPaneStores } from '../stores/scopedPanes';
import { useUiStore } from '../stores/ui';
import { useAiWorkspace } from '@features/chat/stores/aiWorkspace';
import { useChatStore } from '@features/chat/stores/chat';
import { useHarnessWorkspace } from '@features/chat/stores/harnessWorkspace';

vi.mock('@platform/diagnostics', () => ({ invoke: vi.fn(async () => undefined), diagnostic: vi.fn() }));

beforeEach(() => {
  useWorkspaceStore.setState({ tabs: [], activeId: '' });
  useWorkspaceNavigation.setState({ area: 'unified' });
  useUnifiedWorkspace.setState({ layout: null, focused: '', startActive: true });
  useAiWorkspace.setState({ nativeTabs: [], selected: '', order: [] });
  useChatStore.setState({ conversations: [], byTab: {} });
  useHarnessWorkspace.setState({ connections: [] });
  useUiStore.setState({ splitPlacement: { open: false, spec: null } });
  for (const store of Object.values(scopedPaneStores)) store.setState({ layout: null, focused: '', choosingSplit: false });
});

it('splits the active comparison instead of the page first comparison', () => {
  const selection = { target: { cwd: '/repo' }, paneId: 'owner#0', path: 'file.ts', scope: 'unstaged' as const };
  useWorkspaceStore.getState().openGitDiff(selection);
  useWorkspaceStore.getState().openGitDiff({ ...selection, scope: 'staged' });
  const page = useWorkspaceStore.getState().tabs.find(tab => tab.kind === 'git-diff');
  const comparison = page?.kind === 'git-diff' ? page.comparisons?.find(item => item.selection.scope === 'staged') : undefined;
  useWorkspaceNavigation.getState().selectArea('code');
  requestWorkspaceSplit();
  expect(scopedPaneStores.code.getState().layout).toMatchObject({ type: 'pane', resourceId: `diff:${comparison!.id}` });
  expect(scopedPaneStores.code.getState().choosingSplit).toBe(true);
});

it('clears a zoom that points at a removed pane', () => {
  useUnifiedWorkspace.getState().reconcile([]);
  const start = useUnifiedWorkspace.getState().activeTabId;
  useUnifiedWorkspace.setState({ layout: { type: 'split', direction: 'row', ratio: 0.5,
    first: { type: 'pane', id: 'first', resourceId: 'terminal:one#0' },
    second: { type: 'pane', id: 'second', resourceId: 'terminal:two#0' } }, activeTabId: start, focused: 'first', startActive: false });
  useUnifiedWorkspace.setState({ zoomed: 'first' });
  useUnifiedWorkspace.getState().removePane('first');
  expect(useUnifiedWorkspace.getState().zoomed).toBeNull();
  expect(workspacePaneCells(useUnifiedWorkspace.getState().layout!)).toHaveLength(1);
});
