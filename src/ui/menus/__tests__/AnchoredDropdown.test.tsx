import { fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { expect, it, vi } from 'vitest';
import AnchoredDropdown from '@ui/menus/AnchoredDropdown';

it('uses the shared non-modal picker and restores the trigger after dismissal', () => {
  const close = vi.fn(); const pick = vi.fn(); const trigger = document.createElement('button'); document.body.append(trigger); trigger.focus();
  function Picker() {
    const panelRef = useRef<HTMLDivElement>(null);
    return <AnchoredDropdown open onClose={close} panelRef={panelRef} aria-label="Profiles"><button onClick={pick}>Profile</button></AnchoredDropdown>;
  }
  const { unmount } = render(<Picker />);
  const picker = screen.getByRole('dialog', { name: 'Profiles' });
  expect(picker).toHaveAttribute('aria-modal', 'false'); expect(picker).toHaveClass('new-tab-dialog');
  fireEvent.click(screen.getByRole('button', { name: 'Profile' })); expect(pick).toHaveBeenCalledOnce(); expect(close).not.toHaveBeenCalled();
  fireEvent.keyDown(picker, { key: 'Escape' }); expect(close).toHaveBeenCalledOnce();
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'Escape' }); expect(close).toHaveBeenCalledTimes(2);
  unmount(); expect(trigger).toHaveFocus(); trigger.remove();
});

it('keeps the captured toolbar anchor when a parent menu has disappeared', () => {
  function Picker() {
    const panelRef = useRef<HTMLDivElement>(null);
    return <AnchoredDropdown open onClose={() => {}} panelRef={panelRef} anchor={{ x: 700, y: 44, aboveY: 16, align: 'end' }} aria-label="Profiles" />;
  }
  const { unmount } = render(<Picker />);
  expect(screen.getByRole('dialog', { name: 'Profiles' })).toHaveStyle({ top: '44px', left: '700px' });
  unmount();
});

it('dismisses before a background editor can consume Escape after focus restoration', () => {
  const close = vi.fn(); const editor = document.createElement('textarea'); document.body.append(editor);
  editor.addEventListener('keydown', event => { event.preventDefault(); event.stopPropagation(); });
  function Picker() { const panelRef = useRef<HTMLDivElement>(null); return <AnchoredDropdown open onClose={close} panelRef={panelRef} aria-label="Agents" />; }
  const view = render(<Picker />);
  editor.focus(); fireEvent.keyDown(editor, { key: 'Escape' });
  expect(close).toHaveBeenCalledOnce();
  view.unmount(); editor.remove();
});

it('leaves Escape to an active child menu before dismissing its parent picker', () => {
  const close = vi.fn();
  function Picker({ suspended }: { suspended: boolean }) {
    const panelRef = useRef<HTMLDivElement>(null);
    return <AnchoredDropdown open suspended={suspended} onClose={close} panelRef={panelRef} aria-label="Profiles" />;
  }
  const view = render(<Picker suspended />);
  fireEvent.keyDown(document.body, { key: 'Escape' });
  expect(close).not.toHaveBeenCalled();
  view.rerender(<Picker suspended={false} />);
  fireEvent.keyDown(document.body, { key: 'Escape' });
  expect(close).toHaveBeenCalledOnce();
});
