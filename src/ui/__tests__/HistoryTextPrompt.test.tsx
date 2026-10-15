import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import HistoryTextPrompt from '../HistoryTextPrompt';

afterEach(cleanup);

const anchor = { x: 20, y: 20 };

function renderPrompt(overrides: Partial<Parameters<typeof HistoryTextPrompt>[0]> = {}) {
  const onSave = vi.fn();
  const onClose = vi.fn();
  render(<HistoryTextPrompt anchor={anchor} label="Note" placeholder="Write a note" value="" saveLabel="Save"
    onSave={onSave} onClose={onClose} testId="prompt" {...overrides} />);
  return { onSave, onClose };
}

describe('HistoryTextPrompt', () => {
  it('saves the edited text and closes', () => {
    const { onSave, onClose } = renderPrompt({ value: 'old' });
    const input = screen.getByRole('textbox', { name: 'Note' });
    fireEvent.change(input, { target: { value: 'new note' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSave).toHaveBeenCalledWith('new note');
    expect(onClose).toHaveBeenCalled();
  });

  it('saves through the primary action', () => {
    const { onSave } = renderPrompt();
    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), { target: { value: 'via button' } });
    fireEvent.click(screen.getByTestId('prompt-save'));
    expect(onSave).toHaveBeenCalledWith('via button');
  });

  it('cancels without saving', () => {
    const { onSave, onClose } = renderPrompt({ value: 'keep' });
    fireEvent.click(screen.getByTestId('prompt-cancel'));
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('requires Ctrl+Enter to save multiline text', () => {
    const { onSave } = renderPrompt({ multiline: true, value: 'draft' });
    const input = screen.getByRole('textbox', { name: 'Note' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
    expect(onSave).toHaveBeenCalledWith('draft');
  });

  it('closes on Escape without saving', () => {
    const { onSave, onClose } = renderPrompt({ value: 'x' });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('saving an empty value still forwards it so the caller can clear the note', () => {
    const { onSave } = renderPrompt({ value: 'anything' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), { target: { value: '' } });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Note' }), { key: 'Enter' });
    expect(onSave).toHaveBeenCalledWith('');
  });
});
