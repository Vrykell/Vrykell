import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { Field, SettingsGroup } from '../components/ui';
import { useSettingsNavigationStore } from '../stores/navigation';

afterEach(() => {
  cleanup();
  useSettingsNavigationStore.getState().setSelected('ai-model');
});

it('names each group and keeps related controls and descriptions together', () => {
  render(<>
    <SettingsGroup title="Display">
      <Field title="Size" description="Size of terminal text"><input aria-label="Size" defaultValue="14" /></Field>
      <Field title="Weight"><input aria-label="Weight" defaultValue="400" /></Field>
    </SettingsGroup>
    <SettingsGroup title="Instructions">
      <Field title="Prompt" layout="stacked"><textarea aria-label="Prompt" defaultValue="Keep answers brief" /></Field>
    </SettingsGroup>
  </>);
  const display = within(screen.getByRole('group', { name: 'Display' }));
  expect(display.getByRole('heading', { name: 'Display' })).toBeVisible();
  expect(display.getByText('Size of terminal text')).toBeVisible();
  expect(display.getByRole('textbox', { name: 'Size' })).toHaveValue('14');
  expect(display.getByRole('textbox', { name: 'Weight' })).toHaveValue('400');
  expect(display.queryByRole('textbox', { name: 'Prompt' })).not.toBeInTheDocument();
  expect(within(screen.getByRole('group', { name: 'Instructions' })).getByRole('textbox', { name: 'Prompt' })).toHaveValue('Keep answers brief');
});

it('focuses the requested control inside a grouped, full-width field without losing its draft', () => {
  const view = render(<SettingsGroup title="Tools">
    <Field title="Permissions" layout="stacked">
      <input aria-label="First tool" defaultValue="allow" />
      <input aria-label="Second tool" defaultValue="ask" />
    </Field>
  </SettingsGroup>);
  act(() => useSettingsNavigationStore.getState().openField('ai-perms', 'Permissions', 'Second tool'));
  expect(screen.getByLabelText('Second tool')).toHaveFocus();
  view.rerender(<SettingsGroup title="Tools">
    <Field title="Permissions" layout="stacked">
      <input aria-label="First tool" defaultValue="allow" />
      <input aria-label="Second tool" defaultValue="deny" />
    </Field>
  </SettingsGroup>);
  expect(screen.getByLabelText('Second tool')).toHaveValue('ask');
  act(() => useSettingsNavigationStore.getState().openField('ai-perms', 'Permissions', 'First tool'));
  expect(screen.getByLabelText('First tool')).toHaveFocus();
});
