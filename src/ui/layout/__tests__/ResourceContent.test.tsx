import { StrictMode, useEffect, useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import ResourceContent, { ResourceContentProvider, ResourceContentSlot } from '@ui/layout/ResourceContent';
import WorkspaceHeader, { WorkspaceHeaderProvider, WorkspaceHeaderSlot } from '@ui/layout/WorkspaceHeader';

it('does not recursively rebuild a resource when another resource registers its slot', () => {
  const mounted = vi.fn();
  function Owner() {
    return <ResourceContent id="owner" active>{() => {
      function OtherSlot() {
        useEffect(() => { mounted(); }, []);
        return <ResourceContentSlot id="other" visible focused />;
      }
      return <OtherSlot />;
    }}</ResourceContent>;
  }
  expect(() => render(<StrictMode><ResourceContentProvider><Owner /></ResourceContentProvider></StrictMode>)).not.toThrow();
  expect(mounted).toHaveBeenCalled();
  expect(document.querySelectorAll('.resource-content-slot')).toHaveLength(1);
});

it('moves a mounted resource and its actions between domain and mixed panes without losing local state', () => {
  const mounted = vi.fn(); const disposed = vi.fn();
  function Document() {
    useEffect(() => { mounted(); return disposed; }, []);
    return <><WorkspaceHeader><button>Save document</button></WorkspaceHeader><input aria-label="Document draft" defaultValue="" /></>;
  }
  function View({ placed }: { placed: boolean }) {
    const [toolbar, setToolbar] = useState<HTMLElement | null>(null);
    return <WorkspaceHeaderProvider><ResourceContentProvider>
      <WorkspaceHeaderSlot />
      <header data-testid="common-toolbar" ref={setToolbar} />
      <section data-testid="mixed-pane"><ResourceContentSlot id="file:one" visible={placed} focused={placed} toolbarTarget={toolbar} /></section>
      <section data-testid="domain"><ResourceContent id="file:one" active={!placed}>{() => <Document />}</ResourceContent></section>
    </ResourceContentProvider></WorkspaceHeaderProvider>;
  }
  const { rerender, unmount } = render(<View placed={false} />);
  const draft = screen.getByRole('textbox', { name: 'Document draft' });
  fireEvent.change(draft, { target: { value: 'Keep this work' } });
  expect(screen.getByTestId('domain')).toContainElement(draft);
  rerender(<View placed />);
  expect(screen.getByTestId('mixed-pane')).toContainElement(draft);
  expect(within(screen.getByTestId('common-toolbar')).getByRole('button', { name: 'Save document' })).toBeVisible();
  expect(within(screen.getByTestId('mixed-pane')).queryByRole('button', { name: 'Save document' })).not.toBeInTheDocument();
  expect(draft).toHaveValue('Keep this work'); expect(mounted).toHaveBeenCalledTimes(1); expect(disposed).not.toHaveBeenCalled();
  rerender(<View placed={false} />);
  expect(screen.getByTestId('domain')).toContainElement(draft); expect(mounted).toHaveBeenCalledTimes(1);
  unmount(); expect(disposed).toHaveBeenCalledTimes(1);
});

it('lets the visible workspace own a resource even when another workspace keeps an inactive slot mounted', () => {
  function View({ common }: { common: boolean }) {
    return <WorkspaceHeaderProvider><ResourceContentProvider><WorkspaceHeaderSlot />
      <section data-testid="common"><ResourceContentSlot id="file:one" visible={common} focused={common} /></section>
      <section data-testid="editor"><ResourceContentSlot id="file:one" visible={!common} focused={!common} retainHeader /></section>
      <ResourceContent id="file:one" active={false}>{() => <><WorkspaceHeader><button>Save</button></WorkspaceHeader><input aria-label="Draft" /></>}</ResourceContent>
    </ResourceContentProvider></WorkspaceHeaderProvider>;
  }
  const view = render(<View common={false} />);
  const draft = screen.getByRole('textbox', { name: 'Draft' });
  fireEvent.change(draft, { target: { value: 'Preserved' } });
  expect(screen.getByTestId('editor')).toContainElement(draft);
  expect(within(screen.getByTestId('workspace-instance-bar')).getByRole('button', { name: 'Save' })).toBeVisible();
  view.rerender(<View common />); expect(screen.getByTestId('common')).toContainElement(draft);
  view.rerender(<View common={false} />); expect(screen.getByTestId('editor')).toContainElement(draft);
  expect(draft).toHaveValue('Preserved');
});
