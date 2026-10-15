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

  it('marks the current option of a radio-style group', () => {
    render(<ContextMenu anchor={{ x: 0, y: 0 }} items={[
      { label: 'Classic mode', checked: true, onClick: () => {} },
      { label: 'Block mode', checked: false, onClick: () => {} },
    ]} onClose={() => {}} />);
    expect(screen.getByRole('menuitemradio', { name: 'Classic mode' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menuitemradio', { name: 'Block mode' })).toHaveAttribute('aria-checked', 'false');
  });

  it('keeps one mark column across radio and plain rows', () => {
    render(<ContextMenu anchor={{ x: 0, y: 0 }} items={[
      { label: 'Edit', onClick: () => {} },
      { label: 'Classic mode', checked: true, onClick: () => {} },
    ]} onClose={() => {}} />);
    const rows = screen.getByRole('menu').querySelectorAll('.workspace-floating-row');
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.querySelector('[data-check-slot]')).not.toBeNull();
  });

  it('adds no mark column to menus without radio rows', () => {
    render(<ContextMenu anchor={{ x: 0, y: 0 }} items={[{ label: 'Copy', onClick: () => {} }]} onClose={() => {}} />);
    expect(screen.getByRole('menu').querySelector('[data-check-slot]')).toBeNull();
  });
});
