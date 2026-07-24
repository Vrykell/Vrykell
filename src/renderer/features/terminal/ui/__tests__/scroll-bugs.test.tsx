/**
 * Dedicated tests for scroll-position bugs.
 *
 * These use a real TerminalBuffer + DomTerminalView (no Tauri mocking needed)
 * to exercise the exact code paths that cause user-visible jumps.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { TerminalBuffer } from '../../engine/buffer';
import { DomTerminalView } from '../TerminalView';

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

  it('renders from the actual scroll position when unpinned', () => {
    // An unpinned user reading history must get the exact slice for their
    // scrollTop — never a snapped/clamped range.
    // ('\r\n' so text line N lives at buffer index N.)
    for (let i = 0; i < 200; i++) buf.write(`line ${i}\r\n`);

    const { container } = renderTerm();
    const view = container.querySelector('[data-testid="terminal-view"]') as HTMLElement;
    const totalH = 200 * LINE_HEIGHT;
    const viewportH = 400;
    setLayout(view, viewportH, totalH);

    // Scroll 10 lines above the bottom (outside the 5-line pinned zone).
    const pos = totalH - viewportH - LINE_HEIGHT * 10;
    Object.defineProperty(view, 'scrollTop', { value: pos, writable: true, configurable: true });
    act(() => { fireEvent.scroll(view); });

    // The re-rendered slice starts at floor(scrollTop / LINE_HEIGHT) - OVERSCAN.
    const expectedStart = Math.floor(pos / LINE_HEIGHT) - 15; // OVERSCAN
    const first = container.querySelector('[data-testid="terminal-line"]');
    expect(first?.textContent).toContain(`line ${expectedStart}`);
    expect(view.scrollTop).toBe(pos);
  });

  it('reverts a browser-initiated downward scroll right after input', () => {
    // While scrolled up reading history, typing makes the browser scroll the
    // off-screen hidden textarea (positioned at the cursor, near the bottom)
    // into view. That jump is not user intent and must be undone.
    for (let i = 0; i < 200; i++) buf.write(`line ${i}\n`);

    const { container } = renderTerm();
    const view = container.querySelector('[data-testid="terminal-view"]') as HTMLElement;
    const textarea = container.querySelector('[data-testid="terminal-textarea"]') as HTMLElement;
    const totalH = 200 * LINE_HEIGHT;
    const viewportH = 400;
    setLayout(view, viewportH, totalH);

    // User scrolls up 50 lines to read history.
    const readPos = totalH - viewportH - LINE_HEIGHT * 50;
    Object.defineProperty(view, 'scrollTop', { value: readPos, writable: true, configurable: true });
    act(() => { fireEvent.scroll(view); });

    // User types a character (arms the input guard)…
    fireEvent.keyDown(textarea, { key: 'a' });

    // …and the browser yanks the container down to reveal the textarea.
    Object.defineProperty(view, 'scrollTop', { value: totalH - viewportH, writable: true, configurable: true });
    act(() => { fireEvent.scroll(view); });

    // The guard restored the reading position.
    expect(view.scrollTop).toBe(readPos);
  });

  it('honors an upward scroll right after input (reading further back)', () => {
    for (let i = 0; i < 200; i++) buf.write(`line ${i}\n`);

    const { container } = renderTerm();
    const view = container.querySelector('[data-testid="terminal-view"]') as HTMLElement;
    const textarea = container.querySelector('[data-testid="terminal-textarea"]') as HTMLElement;
    const totalH = 200 * LINE_HEIGHT;
    const viewportH = 400;
    setLayout(view, viewportH, totalH);

    const readPos = totalH - viewportH - LINE_HEIGHT * 50;
    Object.defineProperty(view, 'scrollTop', { value: readPos, writable: true, configurable: true });
    act(() => { fireEvent.scroll(view); });

    fireEvent.keyDown(textarea, { key: 'a' });

    // The user immediately keeps scrolling UP — always legitimate.
    const higherPos = readPos - LINE_HEIGHT * 10;
    Object.defineProperty(view, 'scrollTop', { value: higherPos, writable: true, configurable: true });
    act(() => { fireEvent.scroll(view); });

    expect(view.scrollTop).toBe(higherPos);
  });
});
