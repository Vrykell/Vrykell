import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import ContextMenu from '../ContextMenu';

describe('independent action menus', () => {
  it('replaces an existing menu even when opened without a pointer press', () => {
    function Example() {
      const [first, setFirst] = useState(true);
      const [second, setSecond] = useState(false);
      return <>
        <button onClick={() => setSecond(true)}>Open another</button>
        {first && <ContextMenu anchor={{ x: 0, y: 0 }} items={[{ label: 'First action', onClick: () => {} }]} onClose={() => setFirst(false)} />}
        {second && <ContextMenu anchor={{ x: 20, y: 20 }} items={[{ label: 'Second action', onClick: () => {} }]} onClose={() => setSecond(false)} />}
      </>;
    }
    render(<Example />);
    fireEvent.click(screen.getByText('Open another'));
    expect(screen.queryByText('First action')).toBeNull();
    expect(screen.getAllByRole('menu')).toHaveLength(1);
    fireEvent.pointerDown(screen.getByText('Second action'));
    expect(screen.getByRole('menu')).toBeVisible();
    fireEvent.pointerDown(document.body, { button: 2 });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('navigates enabled actions and returns keyboard focus to its trigger', () => {
    function Example() {
      const [anchor, setAnchor] = useState<{ x: number; y: number; trigger: HTMLElement } | null>(null);
      return <><button onClick={event => setAnchor({ x: 0, y: 0, trigger: event.currentTarget })}>Actions</button>
        {anchor && <ContextMenu anchor={anchor} itemRole="menuitem" onClose={() => setAnchor(null)} items={[
          { label: 'First', onClick: () => {} }, { label: 'Unavailable', disabled: true, onClick: () => {} }, { label: 'Last', onClick: () => {} },
        ]} />}</>;
    }
    render(<Example />);
    const trigger = screen.getByRole('button', { name: 'Actions' });
    fireEvent.click(trigger);
    expect(screen.getByRole('menuitem', { name: 'First' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(screen.getByRole('menuitem', { name: 'Last' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(screen.getByRole('menuitem', { name: 'First' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveFocus();
  });
});
