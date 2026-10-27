import { act, fireEvent, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Terminal } from '@xterm/xterm';
import { useTerminalFocus } from '../hooks/useTerminalFocus';

const mocks = vi.hoisted(() => ({
  focus: vi.fn(),
  executing: vi.fn(),
  instances: new Map<string, unknown>(),
}));

vi.mock('@features/terminal', () => ({ termInstances: mocks.instances }));
vi.mock('@features/terminal/hooks/useTerminalSession', () => ({ getExecutingTerm: mocks.executing }));
vi.mock('@features/terminal/services/terminalDebug', () => ({ isTerminalDebugEnabled: () => false, terminalDebug: vi.fn() }));

let pane: HTMLDivElement;
let host: HTMLDivElement;

function terminal(element: HTMLElement | null = host) {
  return { element, focus: mocks.focus } as unknown as Terminal;
}

function selectText() {
  const text = document.createElement('p');
  text.textContent = 'selectable block output';
  document.body.appendChild(text);
  const range = document.createRange();
  range.selectNodeContents(text);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  return text;
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.focus.mockClear();
  mocks.executing.mockReset();
  mocks.instances.clear();
  pane = document.createElement('div');
  pane.className = 'terminal-pane';
  host = document.createElement('div');
  host.className = 'xterm';
  pane.appendChild(host);
  document.body.appendChild(pane);
  mocks.executing.mockReturnValue({ term: terminal() });
});

afterEach(() => {
  vi.useRealTimers();
  window.getSelection()?.removeAllRanges();
  pane.remove();
  document.querySelectorAll('body > p').forEach(element => element.remove());
});

describe('useTerminalFocus', () => {
  it('takes idle focus but yields it to a text selection or an active pointer press', () => {
    const { unmount } = renderHook(() => useTerminalFocus(true, 'pane-1'));
    expect(mocks.focus).toHaveBeenCalledTimes(1);

    mocks.focus.mockClear();
    const selected = selectText();
    act(() => vi.advanceTimersByTime(1200));
    expect(mocks.focus).not.toHaveBeenCalled();

    selected.remove();
    window.getSelection()?.removeAllRanges();
    act(() => vi.advanceTimersByTime(500));
    expect(mocks.focus).toHaveBeenCalledTimes(1);

    mocks.focus.mockClear();
    fireEvent.mouseDown(pane, { button: 0 });
    act(() => vi.advanceTimersByTime(1000));
    expect(mocks.focus).not.toHaveBeenCalled();
    fireEvent.mouseUp(pane, { button: 0 });
    act(() => vi.advanceTimersByTime(500));
    expect(mocks.focus).toHaveBeenCalledTimes(1);

    unmount();
    mocks.focus.mockClear();
    act(() => vi.advanceTimersByTime(1000));
    expect(mocks.focus).not.toHaveBeenCalled();
  });

  it('focuses a pane press unless the target is editable, selected text or outside the pane', () => {
    const { unmount } = renderHook(() => useTerminalFocus(true, 'pane-1'));
    mocks.focus.mockClear();

    fireEvent.click(pane);
    expect(mocks.focus).toHaveBeenCalledTimes(1);

    mocks.focus.mockClear();
    const input = document.createElement('input');
    pane.appendChild(input);
    fireEvent.click(input);
    expect(mocks.focus).not.toHaveBeenCalled();

    mocks.focus.mockClear();
    const selected = selectText();
    fireEvent.click(pane);
    expect(mocks.focus).not.toHaveBeenCalled();
    selected.remove();
    window.getSelection()?.removeAllRanges();

    fireEvent.click(document.body);
    expect(mocks.focus).not.toHaveBeenCalled();
    unmount();
  });

  it('falls back to the pane terminal and stays inert without one', () => {
    mocks.executing.mockReturnValue(undefined);
    mocks.instances.set('pane-1', terminal());
    const first = renderHook(() => useTerminalFocus(true, 'pane-1'));
    expect(mocks.focus).toHaveBeenCalledTimes(1);
    first.unmount();

    mocks.focus.mockClear();
    mocks.instances.clear();
    const second = renderHook(() => useTerminalFocus(true, 'pane-1'));
    act(() => vi.advanceTimersByTime(1000));
    expect(mocks.focus).not.toHaveBeenCalled();
    second.unmount();

    const third = renderHook(() => useTerminalFocus(false, 'pane-1'));
    expect(mocks.focus).not.toHaveBeenCalled();
    third.unmount();
  });
});
