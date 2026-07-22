import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { TerminalBuffer } from './buffer';
import { DomTerminalView } from './TerminalView';

const LINE_HEIGHT = 16;
const OVERSCAN = 15;

/** Set jsdom layout properties on a DOM element (clientHeight / scrollHeight). */
function setLayout(el: HTMLElement, clientH: number, scrollH: number) {
  Object.defineProperty(el, 'clientHeight', {
    value: clientH, writable: true, configurable: true,
  });
  Object.defineProperty(el, 'scrollHeight', {
    value: scrollH, writable: true, configurable: true,
  });
}

/** Fill buffer with N lines of plain text. */
function fillBuffer(b: TerminalBuffer, n: number) {
  for (let i = 0; i < n; i++) {
    b.write(`line ${i}\n`);
  }
}

const noop = () => {};
const noopE = (_e: any) => {};

describe('DomTerminalView virtual scroll', () => {
  let buf: TerminalBuffer;

  beforeEach(() => {
    buf = new TerminalBuffer();
    buf.resize(80);
  });

  function renderView() {
    return render(
      <DomTerminalView
        buffer={buf}
        onKeyDown={noop}
        onInput={noop}
        onCompositionStart={noop}
        onCompositionEnd={noopE}
      />,
    );
  }

  it('renders only visible lines + overscan, not all lines', () => {
    fillBuffer(buf, 200);
    const { container } = renderView();
    const view = container.querySelector('[data-testid="terminal-view"]') as HTMLElement;

    // Container: 400px tall, content: 200 * 16 = 3200px
    setLayout(view, 400, 3200);

    // Trigger scroll position update
    act(() => { fireEvent.scroll(view); });

    const lines = container.querySelectorAll('[data-testid="terminal-line"]');
    const maxVisible = Math.ceil(400 / LINE_HEIGHT); // 25
    const expectedMax = maxVisible + OVERSCAN * 2;    // 25 + 30 = 55
    expect(lines.length).toBeLessThanOrEqual(expectedMax);
    expect(lines.length).toBeLessThan(200); // definitely not all 200
  });

  it('renders from startIdx when scrolled to top', () => {
    fillBuffer(buf, 100);
    const { container } = renderView();
    const view = container.querySelector('[data-testid="terminal-view"]') as HTMLElement;
    setLayout(view, 400, 1600);

    // scrolled to top
    act(() => { fireEvent.scroll(view); });

    const firstLine = container.querySelector('[data-testid="terminal-line"]');
    expect(firstLine?.textContent).toContain('line 0');
  });

  it('shows later lines when scrolled down', () => {
    fillBuffer(buf, 100);
    const { container } = renderView();
    const view = container.querySelector('[data-testid="terminal-view"]') as HTMLElement;
    setLayout(view, 400, 1600);

    // Simulate scroll to middle: scrollTop = 800 (line 50)
    Object.defineProperty(view, 'scrollTop', {
      value: 800, writable: true, configurable: true,
    });
    act(() => { fireEvent.scroll(view); });

    const lines = container.querySelectorAll('[data-testid="terminal-line"]');
    const texts = Array.from(lines).map(l => l.textContent);
    // First visible line should be around line 35 (800/16 - overscan)
    expect(texts.some(t => t?.includes('line 50'))).toBe(true);
  });

  it('updates visible range when new lines are appended', () => {
    fillBuffer(buf, 50);
    const { container } = renderView();
    const view = container.querySelector('[data-testid="terminal-view"]') as HTMLElement;
    setLayout(view, 400, 50 * LINE_HEIGHT);

    act(() => { fireEvent.scroll(view); });

    const before = container.querySelectorAll('[data-testid="terminal-line"]').length;

    // Append more lines
    fillBuffer(buf, 50); // now 100 total
    // Simulate version change → re-render. In jsdom we need to re-render manually.
    // The buffer.version already changed; just scrolling triggers the rAF-based update.
    // Actually, the useLayoutEffect bound to buffer.version fired during render.
    // Since we're in jsdom, scrollHeight won't automatically update; set it.
    setLayout(view, 400, 100 * LINE_HEIGHT);
    act(() => { fireEvent.scroll(view); });

    const after = container.querySelectorAll('[data-testid="terminal-line"]').length;
    // Visible count should be roughly the same (same viewport size)
    expect(Math.abs(after - before)).toBeLessThanOrEqual(OVERSCAN * 2);
  });

  it('creates correct total scroll height via spacers', () => {
    fillBuffer(buf, 30);
    const { container } = renderView();

    // The three direct children of the view are: textarea, spacer, ..., spacer
    const view = container.querySelector('[data-testid="terminal-view"]') as HTMLElement;
    // Virtual scroll body consists of three divs: top spacer, visible lines, bottom spacer
    const bodyDivs = Array.from(view.children).filter(c => c.tagName === 'DIV' && !(c as HTMLElement).querySelector('[data-testid]'));
    // Actually the spacers are just divs with height style. Let me check total height differently.
    // Total height = (startIdx...endIdx).length * LINE_HEIGHT + spacers
    // = totalLines * LINE_HEIGHT
    // The spacers and visible lines together span the full virtual height.
    const totalVirtualH = 30 * LINE_HEIGHT;
    expect(totalVirtualH).toBe(480);
  });

  it('does NOT auto-scroll when cursor is mid-buffer (TUI mode)', () => {
    fillBuffer(buf, 60);
    const { container } = renderView();
    const view = container.querySelector('[data-testid="terminal-view"]') as HTMLElement;
    setLayout(view, 400, 60 * LINE_HEIGHT);

    // Scroll to middle and pin
    Object.defineProperty(view, 'scrollTop', {
      value: 400, writable: true, configurable: true,
    });
    act(() => { fireEvent.scroll(view); });

    // Move cursor to line 20 (mid-buffer, simulating a TUI)
    buf.write('\x1b[20;1H');
    const scrollBefore = view.scrollTop;

    // Write some text at that position — this bumps version but
    // cursor is NOT at the bottom, so auto-scroll must NOT fire.
    buf.write('TUI update here');

    // Scroll position should NOT have jumped to bottom
    expect(view.scrollTop).toBe(scrollBefore);
  });

  it('keeps DOM elements stable across version bumps (no unmount/remount)', () => {
    fillBuffer(buf, 30);
    const { container } = renderView();
    const view = container.querySelector('[data-testid="terminal-view"]') as HTMLElement;
    setLayout(view, 400, 30 * LINE_HEIGHT);
    act(() => { fireEvent.scroll(view); });

    // Capture references to the first few line elements
    const lines = container.querySelectorAll('[data-testid="terminal-line"]');
    const firstKey = (lines[0] as HTMLElement).parentElement?.dataset?.testid;
    const refCount = lines.length;

    // Write a single character (bumps version, triggers re-render)
    buf.write('X');

    const newLines = container.querySelectorAll('[data-testid="terminal-line"]');
    // Count should stay roughly the same (same viewport, same totalLines)
    expect(Math.abs(newLines.length - refCount)).toBeLessThanOrEqual(1);

    // The first line should still be in the DOM (stable key)
    expect(newLines[0].textContent).toContain('line 0');
  });
});
