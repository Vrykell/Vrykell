import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import WorkspacePaneCanvas from '../components/WorkspacePaneCanvas';
import type { WorkspacePaneLayout, WorkspaceResource } from '../model/workspaceResources';
import { useUiStore } from '../stores/ui';

vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
afterEach(cleanup);
const first = { type: 'pane' as const, id: 'first', resourceId: 'file:first' };
const second = { type: 'pane' as const, id: 'second', resourceId: 'acp:second' };
const resources: WorkspaceResource[] = [
  { id: first.resourceId, title: 'File', kind: 'document', file: { path: '/file' } },
  { id: second.resourceId, title: 'Agent', kind: 'agent', sessionId: 'second' },
];

it('cancels a hidden placement once even when cancellation rerenders the parent', () => {
  const cancelled = vi.fn();
  function View() {
    const [, refresh] = useState(0);
    return <WorkspacePaneCanvas containerId="hidden" layout={first} focused="first" resources={resources} visible={false} placing
      onFocus={() => {}} onRatio={() => {}} onPlace={() => {}} onCancel={() => {
        cancelled();
        if (cancelled.mock.calls.length > 2) throw new Error('Hidden placement cancellation repeated');
        refresh(value => value + 1);
      }} />;
  }
  expect(() => render(<View />)).not.toThrow();
  expect(cancelled).toHaveBeenCalledTimes(1);
});

it('provides shared editor and agent pane menus without exposing removal for the last pane', () => {
  const remove = vi.fn(); const focus = vi.fn();
  const props = { containerId: 'container', focused: 'first', resources, visible: true, onFocus: focus, onRatio: vi.fn(), onPlace: vi.fn(), onCancel: vi.fn(), onSplit: vi.fn(), onRemove: remove, onMovePane: vi.fn() };
  const layout: WorkspacePaneLayout = { type: 'split', direction: 'row', ratio: 0.5, first, second };
  const view = render(<WorkspacePaneCanvas {...props} layout={layout} />);
  const preventNative = (event: MouseEvent) => event.preventDefault();
  window.addEventListener('contextmenu', preventNative, true);
  for (const resource of resources) {
    fireEvent.contextMenu(view.container.querySelector(`[data-resource-id="${resource.id}"]`)!, { clientX: 20, clientY: 20 });
    fireEvent.click(screen.getByRole('menuitem', { name: '移除此分屏' }));
    expect(remove).toHaveBeenLastCalledWith(resource.id);
    expect(focus).toHaveBeenLastCalledWith(resource.id);
  }
  fireEvent.contextMenu(view.container.querySelector('[data-resource-id="file:first"]')!, { clientX: 20, clientY: 20 });
  fireEvent.click(screen.getByRole('menuitem', { name: '更换窗格位置' }));
  expect(useUiStore.getState().paneMove).toMatchObject({ open: true, containerId: 'container', paneId: 'first' });
  useUiStore.getState().cancelPaneMove();
  view.rerender(<WorkspacePaneCanvas {...props} layout={first} />);
  fireEvent.contextMenu(view.container.querySelector('[data-resource-id="file:first"]')!, { clientX: 20, clientY: 20 });
  expect(screen.queryByRole('menuitem', { name: '移除此分屏' })).toBeNull();
  expect(screen.getByRole('menuitem', { name: '更换窗格位置' })).toBeDisabled();
  expect(screen.getByRole('menuitem', { name: '拆分标签页' })).toBeEnabled();
  window.removeEventListener('contextmenu', preventNative, true);
});
