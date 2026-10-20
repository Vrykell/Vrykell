import { fireEvent, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

const redraw = vi.hoisted(() => vi.fn());
vi.mock('@features/terminal/services/terminalRepaint', () => ({ redrawTerminal: redraw }));
import { useGlobalShortcuts } from '../useGlobalShortcuts';
import { useUiStore } from '@features/workspace';

beforeEach(() => { redraw.mockClear(); useUiStore.setState({ settingsOpen: false, paletteOpen: false, globalSearchOpen: false }); });
it('opens the palette before a focused terminal can consume the shortcut', () => {
  useUiStore.getState().setPaletteOpen(false);
  const { unmount } = renderHook(useGlobalShortcuts);
  const input = document.createElement('textarea'); document.body.append(input);
  const terminalKey = vi.fn(); input.addEventListener('keydown', terminalKey);
  fireEvent.keyDown(input, { key: 'p', ctrlKey: true });
  expect(useUiStore.getState().paletteOpen).toBe(true);
  expect(terminalKey).not.toHaveBeenCalled();
  input.remove(); unmount(); useUiStore.getState().setPaletteOpen(false);
});

it('captures both redraw shortcuts before terminal handlers or browser reload', () => {
  const { unmount } = renderHook(useGlobalShortcuts);
  const input = document.createElement('textarea');
  document.body.append(input);
  const terminalKey = vi.fn();
  input.addEventListener('keydown', terminalKey, true);
  for (const modifier of ['ctrlKey', 'metaKey']) {
    const event = new KeyboardEvent('keydown', { key: 'R', shiftKey: true, [modifier]: true, bubbles: true, cancelable: true });
    input.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  }
  expect(redraw).toHaveBeenCalledTimes(2);
  expect(terminalKey).not.toHaveBeenCalled();
  unmount();
  fireEvent.keyDown(input, { key: 'R', shiftKey: true, ctrlKey: true });
  expect(redraw).toHaveBeenCalledTimes(2);
  input.remove();
});

it('preserves Ctrl+R and composition keys and ignores shortcut autorepeat', () => {
  renderHook(useGlobalShortcuts);
  for (const options of [
    { key: 'r', ctrlKey: true },
    { key: 'R', ctrlKey: true, shiftKey: true, isComposing: true },
    { key: 'R', ctrlKey: true, shiftKey: true, repeat: true },
    { key: 'R', ctrlKey: true, shiftKey: true, altKey: true },
  ]) fireEvent.keyDown(window, options);
  expect(redraw).not.toHaveBeenCalled();
});

it('closes settings on Escape while preserving nested overlays and composition', () => {
  renderHook(useGlobalShortcuts);
  useUiStore.setState({ settingsOpen: true, globalSearchOpen: true });
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(useUiStore.getState().settingsOpen).toBe(true);
  useUiStore.setState({ globalSearchOpen: false });
  fireEvent.keyDown(window, { key: 'Escape', isComposing: true });
  expect(useUiStore.getState().settingsOpen).toBe(true);
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(useUiStore.getState().settingsOpen).toBe(false);
});

it('closes settings before switching to a numbered terminal tab', () => {
  renderHook(useGlobalShortcuts);
  useUiStore.setState({ settingsOpen: true });
  fireEvent.keyDown(window, { key: '1', ctrlKey: true });
  expect(useUiStore.getState().settingsOpen).toBe(false);
});
