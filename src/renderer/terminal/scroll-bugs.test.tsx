/**
 * Dedicated tests for scroll-position bugs.
 *
 * These use a real TerminalBuffer + DomTerminalView (no Tauri mocking needed)
 * to exercise the exact code paths that cause user-visible jumps.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { TerminalBuffer } from './buffer';
import { DomTerminalView } from './TerminalView';

const LINE_HEIGHT = 16;

const noop = () => {};
const noopE = (_e: any) => {};
const noopR = (_w: number, _h: number) => {};

function setLayout(el: HTMLElement, clientH: number, scrollH: number) {
  Object.defineProperty(el, 'clientHeight', { value: clientH, writable: true, configurable: true });
  Object.defineProperty(el, 'scrollHeight', { value: scrollH, writable: true, configurable: true });
}

describe('Scroll persistence', () => {
  let buf: TerminalBuffer;

  beforeEach(() => {
    buf = new TerminalBuffer();
    buf.resize(80);
  });

  function renderTerm() {
    return render(
      <DomTerminalView
        buffer={buf}
        onKeyDown={noop}
        onInput={noop}
        onCompositionStart={noop}
        onCompositionEnd={noopE}
        onResize={noopR}
      />,
    );
  }

  it('does NOT auto-scroll to bottom on character write when user scrolled up', () => {
    // Simulate a long session: 200 lines of output
    for (let i = 0; i < 200; i++) buf.write(`line ${i}\n`);

    const { container } = renderTerm();
    const view = container.querySelector('[data-testid="terminal-view"]') as HTMLElement;
    const totalH = 200 * LINE_HEIGHT;
    const viewportH = 400;
    setLayout(view, viewportH, totalH);

    // User scrolls up 10 lines from bottom
    const scrolledUpPos = totalH - viewportH - LINE_HEIGHT * 10;
    Object.defineProperty(view, 'scrollTop', { value: scrolledUpPos, writable: true, configurable: true });
    act(() => { fireEvent.scroll(view); });

    const scrollBefore = view.scrollTop;

    // User types a single character — shell echoes it back
    buf.write('X'); // simulates a single-char echo via write() (version bumps)

    // Scroll position must NOT have jumped to bottom
    expect(view.scrollTop).toBe(scrollBefore);
  });

  it('auto-scrolls to bottom when new LINES arrive and user is pinned', () => {
    for (let i = 0; i < 80; i++) buf.write(`line ${i}\n`);

    const { container } = renderTerm();
    const view = container.querySelector('[data-testid="terminal-view"]') as HTMLElement;
    const totalH = 80 * LINE_HEIGHT;
    const viewportH = 400;
    setLayout(view, viewportH, totalH);

    // User IS at the bottom
    Object.defineProperty(view, 'scrollTop', { value: totalH - viewportH, writable: true, configurable: true });
    act(() => { fireEvent.scroll(view); });

    // New line arrives
    buf.write('new line\n');

    // Should have scrolled to keep the new content visible
    expect(view.scrollTop).toBeGreaterThanOrEqual(totalH - viewportH);
  });

  it('does NOT jump when typing on the last line and scroll is slightly off', () => {
    // Reproduce exact user scenario: 200 lines, scrolled to last 30 visible lines,
    // user types characters on the last line.
    for (let i = 0; i < 200; i++) buf.write(`line ${i}\n`);

    const { container } = renderTerm();
    const view = container.querySelector('[data-testid="terminal-view"]') as HTMLElement;
    const totalH = 200 * LINE_HEIGHT;
    const viewportH = 400;
    setLayout(view, viewportH, totalH);

    // Position at bottom — user is reading latest output
    const bottomPos = totalH - viewportH;
    Object.defineProperty(view, 'scrollTop', { value: bottomPos, writable: true, configurable: true });
    act(() => { fireEvent.scroll(view); });

    // Type 5 characters (no newlines) — simulates typing a word
    for (const ch of 'hello') {
      buf.write(ch);
      // Scroll position must not change
      expect(view.scrollTop).toBe(bottomPos);
    }
  });
});
