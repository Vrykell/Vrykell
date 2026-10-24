import { useEffect, useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import ResourceContent, { ResourceContentProvider, ResourceContentSlot } from '@ui/layout/ResourceContent';
import WorkspaceHeader, { WorkspaceHeaderProvider, WorkspaceHeaderSlot } from '@ui/layout/WorkspaceHeader';

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
