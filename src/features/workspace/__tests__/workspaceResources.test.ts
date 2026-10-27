import { expect, it } from 'vitest';
import { workspaceResources, rebindWorkspaceResources, replaceWorkspacePaneResource, pruneWorkspacePanes, splitWorkspacePane, workspacePaneIds, type WorkspacePaneLayout } from '../model/workspaceResources';
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

it('rebinds legacy terminal references once while preserving unchanged trees', () => {
  const resources = workspaceResources([{ id: 't', title: 'Shell', kind: 'session', layout: leaf({ id: 't#0', kind: 'local' }) }], [], [], []);
  const old: WorkspacePaneLayout = { type: 'split', direction: 'row', ratio: 0.5, first: { type: 'pane', id: 'a', resourceId: 'terminal:t' }, second: { type: 'pane', id: 'b', resourceId: 'file:unknown' } };
  const next = rebindWorkspaceResources(old, resources);
  expect(workspacePaneIds(next)).toEqual(['terminal:t#0', 'file:unknown']);
  expect(rebindWorkspaceResources(next, resources)).toBe(next);
  expect(workspaceResources([{ id: 'files', kind: 'editor', title: 'Files', files: [{ path: '/' }], selected: { path: '/' } }], [], [], [])[0]!.title).toBe('/');
  expect(workspaceResources([{ id: 'diff', kind: 'git-diff', title: 'Diff', selection: { path: 'a', paneId: '', target: { cwd: '/' }, scope: 'staged' } }], [], [], [])[0]!.id).toBe('diff:diff');
  expect(pruneWorkspacePanes(null, new Set())).toBeNull();
});

it('replaces one reference without changing pane identity or unrelated branches', () => {
  const old: WorkspacePaneLayout = { type: 'split', direction: 'col', ratio: 0.4,
    first: { type: 'pane', id: 'left', resourceId: 'file:draft' },
    second: { type: 'split', direction: 'row', ratio: 0.6,
      first: { type: 'pane', id: 'right', resourceId: 'file:other' },
      second: { type: 'pane', id: 'bottom', resourceId: 'file:untouched' } } };
  const next = replaceWorkspacePaneResource(old, 'file:draft', 'file:saved');
  expect(workspacePaneIds(next)).toEqual(['file:saved', 'file:other', 'file:untouched']);
  if (next.type !== 'split' || old.type !== 'split' || next.second.type !== 'split' || old.second.type !== 'split') throw new Error('Expected split layouts');
  expect(next.first).not.toBe(old.first);
  expect(next.second).toBe(old.second);
  expect(next.second.first).toBe(old.second.first);
  expect(replaceWorkspacePaneResource(next, 'file:missing', 'file:new')).toBe(next);
  expect(replaceWorkspacePaneResource(old, 'file:draft', 'file:draft')).toBe(old);
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
