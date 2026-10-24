import { beforeEach, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from '../stores/workspace';
import { useWorkspaceNavigation } from '../stores/navigation';
import { useUnifiedWorkspace } from '../stores/unifiedWorkspace';
import { useAiWorkspace } from '@features/chat/stores/aiWorkspace';
import { useChatStore } from '@features/chat/stores/chat';
import { useHarnessWorkspace } from '@features/chat/stores/harnessWorkspace';
import { connectUnifiedAgent, createUnifiedResource } from '../services/unifiedWorkspace';
import { renameWorkspaceResource } from '../services/workspaceResources';
import { workspacePaneIds } from '../model/workspaceResources';

vi.mock('@platform/diagnostics', () => ({ invoke: vi.fn(async () => undefined), diagnostic: vi.fn() }));
beforeEach(() => {
  useWorkspaceStore.setState({ tabs: [], activeId: '' });
  useWorkspaceNavigation.setState({ area: 'unified' });
  useUnifiedWorkspace.setState({ layout: null, focused: '', order: [] });
  useAiWorkspace.setState({ nativeTabs: [], selected: '', order: [] });
  useChatStore.setState({ conversations: [], byTab: {} });
  useHarnessWorkspace.setState({ connections: [] });
});

it('creates and splits new resources without replacing the existing pane or exceeding the owner limit', () => {
  createUnifiedResource('terminal');
  const terminal = useUnifiedWorkspace.getState().layout!;
  createUnifiedResource('document', 'row');
  createUnifiedResource('conversation', 'col');
  createUnifiedResource('terminal', 'row');
  const layout = useUnifiedWorkspace.getState().layout!;
  expect(workspacePaneIds(layout).map(id => id.split(':')[0])).toEqual(['terminal', 'file', 'chat', 'terminal']);
  expect(layout.type === 'split' && layout.first).toBe(terminal);
  const tabs = useWorkspaceStore.getState().tabs;
  createUnifiedResource('document', 'col');
  expect(useWorkspaceStore.getState().tabs).toBe(tabs);
  expect(useUnifiedWorkspace.getState().layout).toBe(layout);
  expect(useWorkspaceNavigation.getState().area).toBe('unified');
});

it('splits an agent through its existing connection model and preserves its directory', () => {
  const source = useHarnessWorkspace.getState().connect('agent', '/work/project');
  useUnifiedWorkspace.setState({ layout: { type: 'pane', id: 'source', resourceId: `acp:${source}` }, focused: 'source' });
  connectUnifiedAgent('agent', { leafId: 'source', dir: 'row', position: 'second', rect: { x: 0.5, y: 0, w: 0.5, h: 1 } });
  const connections = useHarnessWorkspace.getState().connections;
  expect(connections).toHaveLength(2);
  expect(connections[1]).toMatchObject({ harness: 'agent', cwd: '/work/project', fresh: true });
  expect(connections[1]!.id).not.toBe(source);
  expect(workspacePaneIds(useUnifiedWorkspace.getState().layout!)).toEqual([`acp:${source}`, `acp:${connections[1]!.id}`]);
});

it('delegates common tab renaming to the original owner', () => {
  createUnifiedResource('terminal');
  const tab = useWorkspaceStore.getState().tabs[0]!;
  renameWorkspaceResource({ kind: 'terminal', id: `terminal:${tab.id}`, tabId: tab.id, title: tab.title }, 'Updated shell');
  expect(useWorkspaceStore.getState().tabs[0]!.title).toBe('Updated shell');
});
