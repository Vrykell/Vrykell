import { useEffect } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import ResourceContent, { ResourceContentProvider, ResourceContentSlot } from '@ui/layout/ResourceContent';
import WorkspaceHeader, { WorkspaceHeaderProvider, WorkspaceHeaderSlot } from '@ui/layout/WorkspaceHeader';

it('moves a mounted resource and its actions between domain and mixed panes without losing local state', () => {
  const mounted = vi.fn(); const disposed = vi.fn();
  function Document() {
    useEffect(() => { mounted(); return disposed; }, []);
    return <><WorkspaceHeader><button>Save document</button></WorkspaceHeader><input aria-label="Document draft" defaultValue="" /></>;
  }
  const view = (placed: boolean) => <WorkspaceHeaderProvider><ResourceContentProvider>
    <WorkspaceHeaderSlot />
    <section data-testid="mixed-pane"><ResourceContentSlot id="file:one" visible={placed} focused={placed} /></section>
    <section data-testid="domain"><ResourceContent id="file:one" active={!placed}>{() => <Document />}</ResourceContent></section>
  </ResourceContentProvider></WorkspaceHeaderProvider>;
  const { rerender, unmount } = render(view(false));
  const draft = screen.getByRole('textbox', { name: 'Document draft' });
  fireEvent.change(draft, { target: { value: 'Keep this work' } });
  expect(screen.getByTestId('domain')).toContainElement(draft);
  rerender(view(true));
  expect(screen.getByTestId('mixed-pane')).toContainElement(draft);
  expect(screen.getByTestId('mixed-pane')).toContainElement(screen.getByText('Save document'));
  expect(draft).toHaveValue('Keep this work'); expect(mounted).toHaveBeenCalledTimes(1); expect(disposed).not.toHaveBeenCalled();
  rerender(view(false));
  expect(screen.getByTestId('domain')).toContainElement(draft); expect(mounted).toHaveBeenCalledTimes(1);
  unmount(); expect(disposed).toHaveBeenCalledTimes(1);
});
