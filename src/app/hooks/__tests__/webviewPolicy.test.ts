import { renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

vi.mock('@features/terminal/services/terminalRepaint', () => ({ redrawTerminal: vi.fn() }));
import { useGlobalShortcuts } from '../useGlobalShortcuts';

it('blocks browser zoom shortcuts, modified wheel zoom and trackpad gestures', () => {
  renderHook(useGlobalShortcuts);

  const zoomKeys = [
    new KeyboardEvent('keydown', { key: '=', ctrlKey: true, bubbles: true, cancelable: true }),
    new KeyboardEvent('keydown', { key: '+', metaKey: true, bubbles: true, cancelable: true }),
    new KeyboardEvent('keydown', { key: '-', ctrlKey: true, bubbles: true, cancelable: true }),
    new KeyboardEvent('keydown', { key: '0', metaKey: true, bubbles: true, cancelable: true }),
    new KeyboardEvent('keydown', { key: '+', code: 'NumpadAdd', ctrlKey: true, bubbles: true, cancelable: true }),
  ];
  for (const event of zoomKeys) {
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  }

  const modifiedWheels = [
    new WheelEvent('wheel', { ctrlKey: true, cancelable: true }),
    new WheelEvent('wheel', { metaKey: true, cancelable: true }),
  ];
  for (const event of modifiedWheels) {
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  }

  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    const event = new Event(type, { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  }

  const ordinaryWheel = new WheelEvent('wheel', { cancelable: true });
  window.dispatchEvent(ordinaryWheel);
  expect(ordinaryWheel.defaultPrevented).toBe(false);
});

it('suppresses the native context menu while allowing application handlers to receive it', () => {
  renderHook(useGlobalShortcuts);
  const target = document.createElement('div');
  document.body.append(target);
  let bubbled = false;
  target.addEventListener('contextmenu', () => { bubbled = true; });

  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  target.dispatchEvent(event);

  expect(event.defaultPrevented).toBe(true);
  expect(bubbled).toBe(true);
  target.remove();
});
