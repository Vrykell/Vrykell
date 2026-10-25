import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import SettingsPopover from '../SettingsPopover';
import Select from '@ui/fields/Select';

afterEach(cleanup);
it('keeps settings open during option selection and child interaction but closes on outside press', () => {
  const close = vi.fn(); const action = vi.fn();
  const view = render(<SettingsPopover anchor={{ x: 8, y: 40 }} label="Preferences" onClose={close}>
    <Select aria-label="Environment" value="one" options={[{ value: 'one', label: 'One' }]} onChange={() => {}}
      action={{ label: 'New profile', onSelect: action }} />
  </SettingsPopover>);
  fireEvent.click(screen.getByRole('combobox'));
  fireEvent.pointerDown(screen.getByRole('button', { name: 'New profile' }));
  fireEvent.click(screen.getByRole('button', { name: 'New profile' }));
  expect(action).toHaveBeenCalledOnce(); expect(close).not.toHaveBeenCalled();
  view.rerender(<SettingsPopover anchor={{ x: 8, y: 40 }} label="Preferences" onClose={close} suspended><button>Setting</button></SettingsPopover>);
  fireEvent.pointerDown(document.body); fireEvent.keyDown(window, { key: 'Escape' });
  expect(close).not.toHaveBeenCalled();
  view.rerender(<SettingsPopover anchor={{ x: 8, y: 40 }} label="Preferences" onClose={close}><button>Setting</button></SettingsPopover>);
  fireEvent.pointerDown(document.body); expect(close).toHaveBeenCalledOnce();
});
