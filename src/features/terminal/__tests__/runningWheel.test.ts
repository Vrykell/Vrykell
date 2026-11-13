import { describe, expect, it } from 'vitest';
import {
  isHistoryAtBottom,
  routeRunningWheel,
  takeWheelWithinMargin,
  WHEEL_BOUNDARY_IDLE,
  WHEEL_ROUTE_MARGIN_PX,
  wheelLeavesRunningTerminal,
} from '../model/runningWheel';

describe('running terminal wheel boundary', () => {
  it('leaves the wheel to the command history when the terminal has no scrollback', () => {
    expect(wheelLeavesRunningTerminal({ viewportY: 0, baseY: 0 }, -120)).toBe(true);
    expect(wheelLeavesRunningTerminal({ viewportY: 0, baseY: 0 }, 120)).toBe(true);
  });

  it('keeps the wheel inside the live scrollback until it reaches an end', () => {
    expect(wheelLeavesRunningTerminal({ viewportY: 5, baseY: 20 }, -120)).toBe(false);
    expect(wheelLeavesRunningTerminal({ viewportY: 5, baseY: 20 }, 120)).toBe(false);
  });

  it('chains upward at the top and downward at the bottom', () => {
    expect(wheelLeavesRunningTerminal({ viewportY: 0, baseY: 20 }, -120)).toBe(true);
    expect(wheelLeavesRunningTerminal({ viewportY: 20, baseY: 20 }, 120)).toBe(true);
    expect(wheelLeavesRunningTerminal({ viewportY: 20, baseY: 20 }, -120)).toBe(false);
    expect(wheelLeavesRunningTerminal({ viewportY: 0, baseY: 20 }, 120)).toBe(false);
  });

  it('never traps a horizontal or zero vertical delta', () => {
    expect(wheelLeavesRunningTerminal({ viewportY: 5, baseY: 20 }, 0)).toBe(true);
  });
});

describe('history bottom detection', () => {
  it('accepts the exact end and a fractional remainder', () => {
    expect(isHistoryAtBottom({ scrollHeight: 1000, scrollTop: 600, clientHeight: 400 })).toBe(true);
    expect(isHistoryAtBottom({ scrollHeight: 1000, scrollTop: 599.5, clientHeight: 400 })).toBe(true);
  });

  it('rejects a history that still has newer content below', () => {
    expect(isHistoryAtBottom({ scrollHeight: 1000, scrollTop: 500, clientHeight: 400 })).toBe(false);
  });
});

describe('surface boundary margin', () => {
  it('trims only the margin and leaves the rest of a large notch for the same gesture', () => {
    const result = takeWheelWithinMargin(WHEEL_BOUNDARY_IDLE, -100);
    expect(result.remaining).toBe(WHEEL_ROUTE_MARGIN_PX - 100);
    expect(result.state).toEqual({ direction: -1, distance: WHEEL_ROUTE_MARGIN_PX });
  });

  it('trims small deltas until they add up to the margin, then passes the remainder', () => {
    let state = WHEEL_BOUNDARY_IDLE;
    let remaining = 0;
    for (let index = 0; index < 4; index += 1) {
      const result = takeWheelWithinMargin(state, -10);
      state = result.state;
      remaining = result.remaining;
    }
    expect(remaining).toBe(WHEEL_ROUTE_MARGIN_PX - 40);
    expect(state).toEqual({ direction: -1, distance: WHEEL_ROUTE_MARGIN_PX });
  });

  it('passes a full delta once the margin is consumed', () => {
    const result = takeWheelWithinMargin({ direction: -1, distance: WHEEL_ROUTE_MARGIN_PX }, -120);
    expect(result.remaining).toBe(-120);
  });

  it('restarts the margin when the gesture changes direction', () => {
    const held = takeWheelWithinMargin(WHEEL_BOUNDARY_IDLE, -20);
    const reversed = takeWheelWithinMargin(held.state, 20);
    expect(reversed.remaining).toBe(0);
    expect(reversed.state).toEqual({ direction: 1, distance: 20 });
  });

  it('lets horizontal or zero vertical input through untouched', () => {
    expect(takeWheelWithinMargin(WHEEL_BOUNDARY_IDLE, 0)).toEqual({ state: WHEEL_BOUNDARY_IDLE, remaining: 0 });
  });
});

describe('running wheel routing', () => {
  const terminal = (viewportY: number, baseY: number) => ({ viewportY, baseY });

  it('routes a downward gesture to the history while it still has newer content in view', () => {
    const result = routeRunningWheel(
      { position: terminal(5, 20), historyScrollable: true, delta: 120, historyDelta: 120 },
      WHEEL_BOUNDARY_IDLE,
    );
    expect(result.route).toEqual({ surface: 'history', delta: 120 });
    expect(result.boundary).toEqual(WHEEL_BOUNDARY_IDLE);
  });

  it('routes an upward gesture to the live terminal even while the history is scrollable', () => {
    const result = routeRunningWheel(
      { position: terminal(5, 20), historyScrollable: true, delta: -120, historyDelta: -120 },
      WHEEL_BOUNDARY_IDLE,
    );
    expect(result.route).toEqual({ surface: 'terminal' });
    expect(result.boundary).toEqual(WHEEL_BOUNDARY_IDLE);
  });

  it('keeps the wheel on the native terminal path while the scrollback has room', () => {
    const result = routeRunningWheel(
      { position: terminal(5, 20), historyScrollable: false, delta: 120, historyDelta: 120 },
      WHEEL_BOUNDARY_IDLE,
    );
    expect(result.route).toEqual({ surface: 'terminal' });
    expect(result.boundary).toEqual(WHEEL_BOUNDARY_IDLE);
  });

  it('hands an upward gesture to the history once the live scrollback ends, after the margin', () => {
    const first = routeRunningWheel(
      { position: terminal(0, 20), historyScrollable: false, delta: -120, historyDelta: -120 },
      WHEEL_BOUNDARY_IDLE,
    );
    expect(first.route).toEqual({ surface: 'history', delta: WHEEL_ROUTE_MARGIN_PX - 120 });
    const second = routeRunningWheel(
      { position: terminal(0, 20), historyScrollable: false, delta: -120, historyDelta: -120 },
      first.boundary,
    );
    expect(second.route).toEqual({ surface: 'history', delta: -120 });
  });

  it('absorbs a gesture that sits on a boundary with nothing left to move', () => {
    const result = routeRunningWheel(
      { position: terminal(20, 20), historyScrollable: false, delta: 120, historyDelta: 120 },
      WHEEL_BOUNDARY_IDLE,
    );
    expect(result.route).toEqual({ surface: 'boundary' });
    expect(result.boundary).toEqual({ direction: 1, distance: WHEEL_ROUTE_MARGIN_PX });
  });

  it('chains a scrollback-less terminal straight to the history after the margin', () => {
    const result = routeRunningWheel(
      { position: terminal(0, 0), historyScrollable: false, delta: -120, historyDelta: -120 },
      WHEEL_BOUNDARY_IDLE,
    );
    expect(result.route).toEqual({ surface: 'history', delta: WHEEL_ROUTE_MARGIN_PX - 120 });
  });

  it('keeps a fullscreen terminal on its native path with no history to chain into', () => {
    const held = { direction: -1, distance: WHEEL_ROUTE_MARGIN_PX } as const;
    const result = routeRunningWheel(
      { position: terminal(0, 20), historyScrollable: null, delta: -120, historyDelta: -120 },
      held,
    );
    expect(result.route).toEqual({ surface: 'terminal' });
    expect(result.boundary).toEqual(held);
  });

  it('absorbs zero vertical deltas at a boundary without moving the margin', () => {
    const result = routeRunningWheel(
      { position: terminal(5, 20), historyScrollable: false, delta: 0, historyDelta: 0 },
      WHEEL_BOUNDARY_IDLE,
    );
    expect(result.route).toEqual({ surface: 'boundary' });
    expect(result.boundary).toEqual(WHEEL_BOUNDARY_IDLE);
  });
});
