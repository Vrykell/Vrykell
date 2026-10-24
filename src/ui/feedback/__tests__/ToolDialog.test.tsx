import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import ToolDialog from '@ui/feedback/ToolDialog';
import { t } from '@i18n';

it('focuses the requested field and exposes a modal tool with shared dismissal behavior', async () => {
  const close = vi.fn();
  render(<ToolDialog label="Edit root" onClose={close} initialFocus="input"><input aria-label="Root" /></ToolDialog>);
  expect(screen.getByRole('dialog', { name: 'Edit root' })).toHaveAttribute('aria-modal', 'true');
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Root' })).toHaveFocus());
  fireEvent.click(screen.getByRole('textbox', { name: 'Root' }));
  expect(close).not.toHaveBeenCalled();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(close).toHaveBeenCalledOnce();
});

it('replaces the heading close icon with one labeled footer button when asked', () => {
  const close = vi.fn();
  render(<ToolDialog label="Properties" onClose={close} closePlacement="footer">Body</ToolDialog>);

  const buttons = screen.getAllByRole('button');
  expect(buttons).toHaveLength(1);
  expect(buttons[0]).toHaveTextContent(t('Close'));
  fireEvent.click(buttons[0]);
  expect(close).toHaveBeenCalledOnce();
});

it('prevents dismissal while a save is pending', () => {
  const close = vi.fn();
  render(<ToolDialog label="Edit root" onClose={close} busy><input /></ToolDialog>);
  fireEvent.click(document.querySelector('.tool-dialog-overlay')!);
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.getByRole('button', { name: t('Close') })).toBeDisabled();
  expect(close).not.toHaveBeenCalled();
});
