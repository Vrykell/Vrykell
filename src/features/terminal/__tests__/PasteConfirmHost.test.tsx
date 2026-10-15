import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import PasteConfirmHost from '@features/terminal/components/PasteConfirmHost';
import {
  requestPasteConfirm,
  settlePasteConfirm,
  usePasteConfirmStore,
} from '@features/terminal/stores/pasteConfirm';

describe('paste confirmation surface', () => {
  beforeEach(() => {
    settlePasteConfirm(false);
  });

  it('mounts nothing until a paste asks a question', () => {
    render(<PasteConfirmHost />);
    expect(screen.queryByTestId('confirm-dialog')).toBeNull();
  });

  it('reports the size of a multi-line paste and releases it on confirm', async () => {
    render(<PasteConfirmHost />);
    let answer: Promise<boolean> | undefined;
    act(() => { answer = requestPasteConfirm({ reason: 'lines', lines: 12, chars: 340 }); });

    const dialog = await screen.findByTestId('confirm-dialog');
    expect(dialog).toHaveTextContent('12');
    expect(dialog).toHaveTextContent('340');
    expect(dialog).toHaveTextContent('逐行执行');

    fireEvent.click(screen.getByTestId('confirm-ok'));
    await act(async () => { await expect(answer).resolves.toBe(true); });
    expect(usePasteConfirmStore.getState().request).toBeNull();
    expect(screen.queryByTestId('confirm-dialog')).toBeNull();
  });

  it('a cancelled question answers no and closes', async () => {
    render(<PasteConfirmHost />);
    let answer: Promise<boolean> | undefined;
    act(() => { answer = requestPasteConfirm({ reason: 'size', lines: 1, chars: 70_000 }); });

    await screen.findByTestId('confirm-dialog');
    fireEvent.click(screen.getByTestId('confirm-cancel'));
    await act(async () => { await expect(answer).resolves.toBe(false); });
    expect(usePasteConfirmStore.getState().request).toBeNull();
  });

  it('answers the older question with no when a new paste asks while it is open', async () => {
    render(<PasteConfirmHost />);
    let first: Promise<boolean> | undefined;
    let second: Promise<boolean> | undefined;
    act(() => { first = requestPasteConfirm({ reason: 'lines', lines: 8, chars: 120 }); });
    await screen.findByTestId('confirm-dialog');

    act(() => { second = requestPasteConfirm({ reason: 'size', lines: 1, chars: 80_000 }); });
    await act(async () => { await expect(first).resolves.toBe(false); });

    fireEvent.click(screen.getByTestId('confirm-ok'));
    await act(async () => { await expect(second).resolves.toBe(true); });
  });
});
