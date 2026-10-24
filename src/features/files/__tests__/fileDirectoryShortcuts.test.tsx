import { fireEvent, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useFileDirectoryShortcuts } from '../hooks/useFileDirectoryShortcuts';

it('uses the same two actions from anywhere while the panel is enabled', () => {
  const terminal = vi.fn(); const panel = vi.fn();
  const { rerender } = renderHook(({ enabled }) => useFileDirectoryShortcuts(enabled, terminal, panel), { initialProps: { enabled: true } });
  fireEvent.keyDown(window, { key: 'l', code: 'KeyL', ctrlKey: true, altKey: true });
  fireEvent.keyDown(window, { key: 'L', code: 'KeyL', metaKey: true, altKey: true, shiftKey: true });
  expect(terminal).toHaveBeenCalledOnce(); expect(panel).toHaveBeenCalledOnce();
  rerender({ enabled: false });
  fireEvent.keyDown(window, { key: 'l', ctrlKey: true, altKey: true });
  expect(terminal).toHaveBeenCalledOnce();
});

it('does not act during composition, repetition or a modal interaction', () => {
  const terminal = vi.fn();
  renderHook(() => useFileDirectoryShortcuts(true, terminal));
  for (const extra of [{ isComposing: true }, { repeat: true }, { keyCode: 229 }]) {
    fireEvent.keyDown(window, { key: 'l', ctrlKey: true, altKey: true, ...extra });
  }
  const dialog = document.createElement('div'); dialog.setAttribute('role', 'dialog'); document.body.append(dialog);
  fireEvent.keyDown(window, { key: 'l', ctrlKey: true, altKey: true }); dialog.remove();
  expect(terminal).not.toHaveBeenCalled();
});
