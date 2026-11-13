import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Terminal } from '@xterm/xterm';
import { installRunningWheelRouting } from '../services/runningWheelRouting';

/** History surface with a fixed geometry, standing in for the pane's scroller. */
function makeScroll(contentHeight: number, viewportHeight: number, scrollTop: number) {
  const el = document.createElement('div');
  let top = scrollTop;
  Object.defineProperties(el, {
    scrollHeight: { value: contentHeight, configurable: true },
    clientHeight: { value: viewportHeight, configurable: true },
    scrollTop: {
      get: () => top,
      set: (next: number) => { top = Math.max(0, Math.min(next, contentHeight - viewportHeight)); },
      configurable: true,
    },
  });
  return el;
}

/** Live terminal stand-in exposing only what the router reads. */
function makeTerm(viewportY: number, baseY: number) {
  const scrollLines = vi.fn((lines: number) => {
    term.buffer.active.viewportY = Math.max(0, Math.min(term.buffer.active.viewportY + lines, baseY));
  });
  const term = {
    buffer: { active: { viewportY, baseY, type: 'normal' as const } },
    modes: { mouseTrackingMode: 'none' as const },
    rows: 24,
    scrollLines,
  };
  return { term: term as unknown as Terminal, scrollLines, state: term.buffer.active };
}

function wheel(target: Element, deltaY: number) {
  const event = new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

/** Mount the router on a scroller that already contains a running-terminal host. */
function mount(scroll: HTMLElement, terminal: Terminal | null) {
  const host = document.createElement('div');
  host.dataset.testid = 'running-term';
  const screen = document.createElement('div');
  host.appendChild(screen);
  scroll.appendChild(host);
  cleanups.push(installRunningWheelRouting(scroll, () => terminal));
  return { host, screen };
}

describe('running wheel routing service', () => {
  it('hands a downward wheel to the live terminal once the history sits at its newest content', () => {
    // The reported failure: the history is already at the bottom, so scrolling down must reach
    // the running terminal even though the pointer is not over it.
    const scroll = makeScroll(1000, 400, 600);
    const { term, scrollLines, state } = makeTerm(10, 40);
    const { screen } = mount(scroll, term);

    const event = wheel(screen, 120);

    expect(scrollLines).toHaveBeenCalled();
    expect(state.viewportY).toBeGreaterThan(10);
    expect(scroll.scrollTop).toBe(600);
    expect(event.defaultPrevented).toBe(true);
  });

  it('keeps scrolling the history with the pointer away from the running terminal', () => {
    const scroll = makeScroll(1000, 400, 200);
    const { term, scrollLines } = makeTerm(10, 40);
    mount(scroll, term);

    // A wheel addressed to the history body, with older commands still above the viewport.
    const event = wheel(scroll, -120);

    expect(scrollLines).not.toHaveBeenCalled();
    expect(scroll.scrollTop).toBe(200);
    expect(event.defaultPrevented).toBe(false);
  });

  it('reads the live scrollback first when scrolling up over the running terminal', () => {
    const scroll = makeScroll(1000, 400, 600);
    const { term, scrollLines } = makeTerm(20, 40);
    const { screen } = mount(scroll, term);

    wheel(screen, -120);

    expect(scrollLines).toHaveBeenCalled();
    expect(scroll.scrollTop).toBe(600);
  });

  it('chains an upward wheel into the history from the top of the live scrollback', () => {
    const scroll = makeScroll(1000, 400, 600);
    const { term, scrollLines } = makeTerm(0, 40);
    const { screen } = mount(scroll, term);

    // Over the terminal, live scrollback exhausted: the same gesture continues in the history.
    wheel(screen, -120);
    expect(scroll.scrollTop).toBeLessThan(600);
    expect(scrollLines).not.toHaveBeenCalled();
  });

  it('leaves alternate-screen and mouse-protocol programs to their own wheel input', () => {
    const scroll = makeScroll(1000, 400, 600);
    const { term, scrollLines } = makeTerm(10, 40);
    (term as unknown as { buffer: { active: { type: string } } }).buffer.active.type = 'alternate';
    const { screen } = mount(scroll, term);

    const event = wheel(screen, 120);

    expect(scrollLines).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('does nothing without a live terminal', () => {
    const scroll = makeScroll(1000, 400, 0);
    mount(scroll, null);

    const event = wheel(scroll, -120);

    expect(event.defaultPrevented).toBe(false);
    expect(scroll.scrollTop).toBe(0);
  });

  it('reverses direction without leaking the previous gesture remainder', () => {
    const scroll = makeScroll(1000, 400, 600);
    const { term, state } = makeTerm(30, 40);
    const { screen } = mount(scroll, term);

    wheel(screen, 120);
    const afterDown = state.viewportY;
    wheel(screen, -120);

    expect(afterDown).toBeGreaterThan(30);
    expect(state.viewportY).toBeLessThan(afterDown);
  });

  it('leaves a horizontal-only gesture alone', () => {
    const scroll = makeScroll(1000, 400, 600);
    const { term, scrollLines } = makeTerm(10, 40);
    const { screen } = mount(scroll, term);

    const event = wheel(screen, 0);

    expect(scrollLines).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('stops listening once cleaned up', () => {
    const scroll = makeScroll(1000, 400, 600);
    const { term, scrollLines } = makeTerm(10, 40);
    const { screen } = mount(scroll, term);
    cleanups.pop()!();

    const event = wheel(screen, 120);

    expect(scrollLines).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});
