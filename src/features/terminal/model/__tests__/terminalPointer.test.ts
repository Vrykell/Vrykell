import type { Terminal } from '@xterm/xterm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureTerminalPointer } from '../terminalPointer';

vi.mock('../../services/terminalDebug', () => ({ terminalDebug: vi.fn() }));
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup() {
  const element = document.createElement('div');
  const textarea = document.createElement('textarea');
  element.append(textarea);
  const modes = { mouseTrackingMode: 'none' };
  const term = { element, textarea, modes } as unknown as Terminal;
  const dispose = configureTerminalPointer(term, 'pane-test');
  const hover = vi.fn();
  textarea.addEventListener('mousemove', hover);
  const key = (init: KeyboardEventInit = {}) => textarea.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'a', ...init }));
  const move = (init: MouseEventInit = {}) => textarea.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, ...init }));
  return { element, textarea, modes, dispose, hover, key, move };
}

describe('terminal pointer while typing', () => {
  it('keeps hover suppressed across repeated keys and restores it after typing stops', () => {
    const { element, key, move, hover, dispose } = setup();
    key();
    move();
    expect(element.dataset.terminalTyping).toBe('true');
    expect(hover).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    key({ repeat: true });
    vi.advanceTimersByTime(200);
    move();
    expect(hover).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(element.hasAttribute('data-terminal-typing')).toBe(false);
    move();
    expect(hover).toHaveBeenCalledOnce();
    dispose();
  });

  it('restores immediately for clicking, dragging, leaving and losing focus', () => {
    const { element, key, move, hover, dispose } = setup();
    key(); move({ buttons: 1 });
    expect(hover).toHaveBeenCalledOnce();
    expect(element.hasAttribute('data-terminal-typing')).toBe(false);
    for (const event of [new Event('pointerdown', { bubbles: true }), new Event('mouseleave'), new Event('focusout', { bubbles: true })]) {
      key(); element.dispatchEvent(event);
      expect(element.hasAttribute('data-terminal-typing')).toBe(false);
    }
    dispose();
  });

  it('preserves shortcuts, composition and application mouse reporting', () => {
    const { element, modes, key, move, hover, dispose } = setup();
    for (const init of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }, { isComposing: true }, { key: 'Shift' }]) {
      key(init);
      expect(element.hasAttribute('data-terminal-typing')).toBe(false);
    }
    key();
    modes.mouseTrackingMode = 'any';
    move();
    expect(hover).toHaveBeenCalledOnce();
    expect(element.hasAttribute('data-terminal-typing')).toBe(false);
    key();
    expect(element.hasAttribute('data-terminal-typing')).toBe(false);
    dispose();
  });

  it('removes its timer and handlers when the terminal is disposed', () => {
    const { element, key, move, hover, dispose } = setup();
    key(); dispose();
    expect(element.hasAttribute('data-terminal-typing')).toBe(false);
    key(); move();
    expect(hover).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
