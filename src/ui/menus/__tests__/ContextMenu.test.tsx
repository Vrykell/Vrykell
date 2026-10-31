import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import ContextMenu from '@ui/menus/ContextMenu';
import Select from '@ui/fields/Select';

describe('independent action menus', () => {
  it('captures the selected row position before closing its menu', () => {
    const action = vi.fn(); const close = vi.fn();
    render(<ContextMenu anchor={{ x: 400, y: 100 }} items={[{ label: 'Choose profile', onClick: action }]} onClose={close} />);
    const row = screen.getByRole('button', { name: 'Choose profile' });
    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({ left: 420, bottom: 236 } as DOMRect);
    fireEvent.click(row);
    expect(action).toHaveBeenCalledWith({ x: 420, y: 240 }, { x: 400, y: 100 });
    expect(close).toHaveBeenCalledOnce();
  });
  it('keeps a controlled select action inside its owning menu during pointer presses', () => {
    const action = vi.fn();
    function Example() {
      const [open, setOpen] = useState(true);
      return open && <ContextMenu anchor={{ x: 0, y: 0 }} onClose={() => setOpen(false)} items={[]}
        header={<Select aria-label="Environment" value="discussion" options={[{ value: 'discussion', label: 'Discussion' }]} onChange={() => {}}
          action={{ label: 'Create terminal', onSelect: action }} />} />;
    }
    render(<Example />);
    fireEvent.click(screen.getByRole('combobox'));
    const button = screen.getByRole('button', { name: 'Create terminal' });
    fireEvent.pointerDown(button);
    expect(screen.getByRole('menu')).toBeVisible();
    fireEvent.click(button);
    expect(action).toHaveBeenCalledOnce();
    expect(screen.getByRole('menu')).toBeVisible();
  });
  it('keeps header text editing keys local and distinguishes cancellation from committing dismissal', () => {
    const close = vi.fn(); const cancel = vi.fn();
    render(<ContextMenu anchor={{ x: 0, y: 0 }} header={<input aria-label="Group name" defaultValue="Work" />} onClose={close} onCancel={cancel}
      items={[{ label: 'Archive', onClick: () => {} }]} />);
    const input = screen.getByRole('textbox', { name: 'Group name' });
    expect(input).toHaveFocus();
    expect(fireEvent.keyDown(input, { key: 'Home' })).toBe(true);
    expect(fireEvent.keyDown(input, { key: 'ArrowLeft' })).toBe(true);
    expect(fireEvent.keyDown(input, { key: 'Tab' })).toBe(true);
    const shortcut = vi.fn();
    window.addEventListener('keydown', shortcut);
    fireEvent.keyDown(input, { key: 't', ctrlKey: true });
    window.removeEventListener('keydown', shortcut);
    expect(shortcut).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(cancel).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
    fireEvent.pointerDown(document.body);
    expect(close).toHaveBeenCalledOnce();
  });
  it('opens nested settings by pointer or keyboard and closes one level at a time', () => {
    const apply = vi.fn(); const close = vi.fn();
    render(<ContextMenu anchor={{ x: 0, y: 0 }} itemRole="menuitem" onClose={close} items={[
      { label: 'Settings', submenu: { items: [
        { label: 'Opening mode', submenu: { items: [{ label: 'Block', checked: true, onClick: apply }] } },
      ] } },
      { label: 'Disabled', disabled: true, submenu: { items: [{ label: 'Hidden' }] } },
      { label: 'Copy', onClick: vi.fn() },
    ]} />);
    const settings = screen.getByRole('menuitem', { name: 'Settings' });
    expect(settings).toHaveAttribute('aria-haspopup', 'menu');
    fireEvent.keyDown(settings, { key: 'ArrowRight' });
    const mode = screen.getByRole('menuitem', { name: 'Opening mode' });
    expect(mode).toHaveFocus();
    fireEvent.keyDown(mode, { key: 'ArrowRight' });
    expect(screen.getByRole('menuitemradio', { name: 'Block' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    expect(mode).toHaveFocus(); expect(screen.getAllByRole('menu')).toHaveLength(2);
    fireEvent.keyDown(mode, { key: 'Escape' });
    expect(settings).toHaveFocus(); expect(close).not.toHaveBeenCalled();
    fireEvent.pointerEnter(settings);
    fireEvent.pointerEnter(screen.getByRole('menuitem', { name: 'Opening mode' }));
    fireEvent.pointerDown(screen.getByRole('menuitemradio', { name: 'Block' }));
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Block' }));
    expect(apply).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalledOnce();
  });

  it('keeps color choices below actions and removes deeper surfaces when another action is hovered', () => {
    render(<ContextMenu anchor={{ x: 0, y: 0 }} onClose={vi.fn()} items={[
      { label: 'View', submenu: { items: [{ label: 'Compact', onClick: vi.fn() }] } }, { label: 'Copy', onClick: vi.fn() },
    ]} footer={<button>Blue</button>} />);
    expect(screen.getByRole('button', { name: 'Blue' })).toBeVisible();
    fireEvent.click(screen.getByRole('menuitem', { name: 'View' }));
    expect(screen.getByRole('button', { name: 'Compact' })).toHaveFocus();
    fireEvent.pointerEnter(screen.getByRole('button', { name: 'Copy' }));
    expect(screen.queryByText('Compact')).toBeNull();
    expect(screen.getByRole('button', { name: 'Blue' })).toBeVisible();
  });
  it('uses the destructive text treatment for both explicit danger and removal groups', () => {
    render(<ContextMenu anchor={{ x: 0, y: 0 }} items={[
      { label: 'Delete record', danger: true, onClick: () => {} },
      { label: 'Close tab', group: 'danger', onClick: () => {} },
      { label: 'Copy', onClick: () => {} },
    ]} onClose={() => {}} />);
    expect(screen.getByRole('button', { name: 'Delete record' })).toHaveStyle({ color: 'var(--control-danger-color)' });
    expect(screen.getByRole('button', { name: 'Close tab' })).toHaveStyle({ color: 'var(--control-danger-color)' });
    expect(screen.getByRole('button', { name: 'Copy' })).toHaveStyle({ color: 'var(--text-primary)' });
  });
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

  it('places labels first and selection marks last without indenting plain rows', () => {
    render(<ContextMenu anchor={{ x: 0, y: 0 }} items={[
      { label: 'Edit', onClick: () => {} },
      { label: 'Classic mode', checked: true, onClick: () => {} },
    ]} onClose={() => {}} />);
    const rows = screen.getByRole('menu').querySelectorAll('.workspace-floating-row');
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.firstElementChild).toHaveAttribute('data-menu-label');
    expect(rows[0].querySelector('[data-check-slot]')).toBeNull();
    expect(rows[1].lastElementChild).toHaveAttribute('data-check-slot');
  });

  it('caps resource menus without stretching short lists to the cap', () => {
    render(<ContextMenu anchor={{ x: 0, y: 0 }} variant="resources" items={[{ label: 'Note', onClick: () => {} }]} onClose={() => {}} />);
    const menu = screen.getByRole('menu');
    expect(menu.style.width).toBe('max-content');
    expect(menu.style.maxWidth).toContain('320px');
  });

  it('adds no mark column to menus without radio rows', () => {
    render(<ContextMenu anchor={{ x: 0, y: 0 }} items={[{ label: 'Copy', onClick: () => {} }]} onClose={() => {}} />);
    expect(screen.getByRole('menu').querySelector('[data-check-slot]')).toBeNull();
  });
});
