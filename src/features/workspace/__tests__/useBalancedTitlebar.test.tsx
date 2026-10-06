import { useRef } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { useBalancedTitlebar } from '../hooks/useBalancedTitlebar';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('updates the space reservation when action width changes and disconnects on unmount', () => {
  let width = 212;
  let resize: (() => void) | undefined;
  const disconnect = vi.fn();
  const observe = vi.fn();
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback; }
    observe = observe;
    disconnect = disconnect;
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
    width, height: 48, x: 0, y: 0, top: 0, left: 0, right: width, bottom: 48, toJSON: () => ({}),
  }));
  function Header() {
    const header = useRef<HTMLElement>(null);
    const actions = useRef<HTMLDivElement>(null);
    useBalancedTitlebar(header, actions);
    return <header ref={header} data-testid="header"><div ref={actions} data-testid="actions" /></header>;
  }
  const { unmount } = render(<Header />);
  expect(observe).toHaveBeenCalledWith(screen.getByTestId('actions'));
  expect(screen.getByTestId('header').style.getPropertyValue('--workspace-actions-width')).toBe('212px');
  width = 319.2;
  resize?.();
  expect(screen.getByTestId('header').style.getPropertyValue('--workspace-actions-width')).toBe('320px');
  width = 176;
  resize?.();
  expect(screen.getByTestId('header').style.getPropertyValue('--workspace-actions-width')).toBe('176px');
  unmount();
  expect(disconnect).toHaveBeenCalledOnce();
});
