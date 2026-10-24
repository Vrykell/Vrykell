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
  unmount(); expect(trigger).toHaveFocus(); trigger.remove();
});
