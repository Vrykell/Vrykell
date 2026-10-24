import { expect, it } from 'vitest';
import { workspaceResources, splitWorkspacePane, workspacePaneIds, type WorkspacePaneLayout } from '../model/workspaceResources';
import { leaf } from '../model/windowLayout';

it('unifies existing resources by stable identities without creating sessions or documents', () => {
  const resources = workspaceResources([
    { id: 'terminal', title: 'Shell', kind: 'session', layout: leaf({ id: 'terminal#0', kind: 'local' }) },
    { id: 'files', title: 'Files', kind: 'editor', files: [{ path: '/file.ts' }], selected: { path: '/file.ts' } },
    { id: 'start', title: 'Start', kind: 'start' },
  ], ['chat', 'removed'], [{ id: 'chat', title: 'Conversation' }], [{ id: 'agent', harness: 'Agent' }]);
  expect(resources.map(item => item.kind)).toEqual(['terminal', 'document', 'conversation', 'agent']);
  expect(new Set(resources.map(item => item.id)).size).toBe(resources.length);
});

it('splits mixed resources by reference without duplicating a live owner', () => {
  const terminal: WorkspacePaneLayout = { type: 'pane', id: 'left', resourceId: 'terminal:one' };
  const document = { type: 'pane' as const, id: 'right', resourceId: 'file:one' };
  const layout = splitWorkspacePane(terminal, 'left', document, 'row');
  expect(workspacePaneIds(layout)).toEqual(['terminal:one', 'file:one']);
  expect(layout.type === 'split' && layout.first).toBe(terminal);
  expect(splitWorkspacePane(layout, 'right', { ...document, id: 'duplicate' }, 'col')).toBe(layout);
  expect(splitWorkspacePane(layout, 'absent', { ...document, id: 'other', resourceId: 'chat:one' }, 'col')).toBe(layout);
});
