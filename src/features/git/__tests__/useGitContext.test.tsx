import { renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { GitSelection } from '@core/git';
import { useGitContext } from '../hooks/useGitContext';
import { useGitContextStore } from '../stores/context';

const context = vi.hoisted(() => ({ activeTab: { kind: 'session' } as { kind: string; selection?: GitSelection }, activeCwd: '/repo/sub' as string | undefined,
  focusedSpec: { kind: 'local' } as { kind: string; ssh?: { connectionId: string } } | null, focusedPaneId: 'pane' }));
vi.mock('@features/workspace', () => ({ useActiveWorkspace: () => context }));
beforeEach(() => { useGitContextStore.setState({ recent: null, sourceKey: '' }); Object.assign(context, { activeTab: { kind: 'session' }, activeCwd: '/repo/sub', focusedSpec: { kind: 'local' }, focusedPaneId: 'pane' }); });
it('retains the canonical repository and owner on utility pages and follows a later terminal directory', () => {
  const { result, rerender } = renderHook(() => useGitContext());
  useGitContextStore.getState().canonicalize(result.current.sourceKey, '/repo');
  Object.assign(context, { activeTab: { kind: 'settings' }, activeCwd: undefined, focusedSpec: null, focusedPaneId: 'settings' });
  rerender();
  expect(result.current).toMatchObject({ target: { cwd: '/repo' }, paneId: 'pane' });
  Object.assign(context, { activeTab: { kind: 'session' }, activeCwd: '/new', focusedSpec: { kind: 'local' }, focusedPaneId: 'pane' });
  rerender();
  expect(result.current.target?.cwd).toBe('/new');
});
it('does not use a previous local repository for an unsaved remote terminal', () => {
  const { result, rerender } = renderHook(() => useGitContext());
  Object.assign(context, { focusedSpec: { kind: 'ssh' }, activeCwd: '/remote' });
  rerender();
  expect(result.current).toMatchObject({ target: null, unavailableConnection: true });
});
it('keeps an explicitly bound terminal when focus and the active editor change', () => {
  const bound = { target: { cwd: '/bound', connectionId: 'remote-bound' }, paneId: 'pane-bound' };
  const { result, rerender } = renderHook(() => useGitContext(bound));
  expect(result.current).toMatchObject({ target: bound.target, paneId: 'pane-bound' });

  Object.assign(context, { activeTab: { kind: 'editor', id: 'editor', selected: { path: '/other/src/file.ts', connectionId: 'remote' } }, focusedSpec: null, activeCwd: undefined });
  rerender();
  expect(result.current).toMatchObject({ target: bound.target, paneId: 'pane-bound' });
  expect(useGitContextStore.getState().recent).toBeNull();
});

it('follows the active editor file and remembers its source page', () => {
  Object.assign(context, { activeTab: { kind: 'editor', id: 'editor', selected: { path: '/other/src/file.ts', connectionId: 'remote' } }, focusedSpec: null, activeCwd: undefined });
  const { result } = renderHook(() => useGitContext());
  expect(result.current).toMatchObject({ target: { cwd: '/other/src', connectionId: 'remote' }, paneId: 'editor' });
});
