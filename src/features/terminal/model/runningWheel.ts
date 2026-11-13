/** Scroll position of the live terminal inside a running command block. */
export interface RunningWheelPosition {
  /** Top line currently shown in the block's terminal. */
  viewportY: number;
  /** Top line at the end of its scrollback (0 when there is none). */
  baseY: number;
}

/** Tolerance that treats a fractional or rounded scroll offset as the end of the history. */
const HISTORY_BOTTOM_EPSILON_PX = 2;

/** Wheel distance trimmed off the first movement across a surface boundary. */
export const WHEEL_ROUTE_MARGIN_PX = 32;

/** Wheel distance already trimmed at the current surface boundary. */
export interface WheelBoundaryState {
  /** Sign of the current gesture's vertical delta. */
  direction: number;
  /** Wheel distance already trimmed at this boundary. */
  distance: number;
}

export const WHEEL_BOUNDARY_IDLE: WheelBoundaryState = { direction: 0, distance: 0 };

/** Whether the command history shows its newest content. */
export function isHistoryAtBottom(scroll: Pick<HTMLElement, 'scrollHeight' | 'scrollTop' | 'clientHeight'>): boolean {
  return scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight <= HISTORY_BOTTOM_EPSILON_PX;
}

/**
 * Trim the boundary margin from a wheel delta and return what remains for the next surface.
 *
 * The margin is a distance rather than a whole event: a large notch keeps moving in the same
 * gesture, and small trackpad deltas are trimmed until they add up to the margin. Keeping the
 * remaining distance in the same event avoids a visible pause followed by a full-size jump.
 * The direction is remembered separately so a reversal starts a fresh margin.
 */
export function takeWheelWithinMargin(state: WheelBoundaryState, delta: number): { state: WheelBoundaryState; remaining: number } {
  const direction = Math.sign(delta);
  if (direction === 0) return { state, remaining: 0 };
  const current = direction === state.direction ? state : { direction, distance: 0 };
  const marginLeft = WHEEL_ROUTE_MARGIN_PX - current.distance;
  if (marginLeft <= 0) return { state: { direction, distance: WHEEL_ROUTE_MARGIN_PX }, remaining: delta };
  const consumed = Math.min(Math.abs(delta), marginLeft);
  return { state: { direction, distance: current.distance + consumed }, remaining: delta - direction * consumed };
}

/**
 * Whether the live terminal has nothing left to scroll in the wheel's direction.
 *
 * Once the command history reaches its newest position the live terminal owns the wheel; at the
 * end of its own scrollback the same gesture must return to the history instead of being trapped
 * by xterm.
 */
export function wheelLeavesRunningTerminal(position: RunningWheelPosition, delta: number): boolean {
  if (position.baseY <= 0) return true;
  if (delta < 0) return position.viewportY <= 0;
  if (delta > 0) return position.viewportY >= position.baseY;
  return true;
}

/** Where a wheel gesture over a running block's live terminal should go next. */
export type RunningWheelRoute =
  /** The surrounding command history scrolls by the given distance. */
  | { surface: 'history'; delta: number }
  /** The live terminal keeps the gesture on its native wheel path. */
  | { surface: 'terminal' }
  /** The gesture sits on a routing boundary with nothing left to move; absorb it. */
  | { surface: 'boundary' };

/** Inputs the running-block wheel router decides from, measured per surface. */
export interface RunningWheelGesture {
  /** Live terminal position and the end of its own scrollback. */
  position: RunningWheelPosition;
  /**
   * Whether the surrounding command history still has content above its newest position;
   * null when the terminal has no surrounding history (manual fullscreen).
   */
  historyScrollable: boolean | null;
  /** Wheel distance in px measured on the live terminal surface. */
  delta: number;
  /** Wheel distance in px measured on the surrounding history surface. */
  historyDelta: number;
}

/**
 * Route one wheel event between the live terminal and the surrounding command history.
 *
 * Scrolling down first unwinds the outer history, because that brings the full running
 * terminal back into view; scrolling up reads the live scrollback first and only reaches
 * for older commands once that scrollback ends. Either hand-off trims the boundary margin
 * from the first movement so the same gesture continues without a pause.
 */
export function routeRunningWheel(
  gesture: RunningWheelGesture,
  boundary: WheelBoundaryState,
): { route: RunningWheelRoute; boundary: WheelBoundaryState } {
  const direction = Math.sign(gesture.delta);
  if (gesture.historyScrollable === true && direction > 0) {
    return { route: { surface: 'history', delta: gesture.historyDelta }, boundary: WHEEL_BOUNDARY_IDLE };
  }
  if (!wheelLeavesRunningTerminal(gesture.position, gesture.delta)) {
    return { route: { surface: 'terminal' }, boundary: WHEEL_BOUNDARY_IDLE };
  }
  if (gesture.historyScrollable === null) {
    return { route: { surface: 'terminal' }, boundary };
  }
  const trimmed = takeWheelWithinMargin(boundary, gesture.delta);
  if (trimmed.remaining === 0 || direction > 0) {
    // A downward gesture past the live end has nowhere left to go: the history already shows
    // its newest content, so the boundary absorbs the rest of the movement.
    return { route: { surface: 'boundary' }, boundary: trimmed.state };
  }
  return { route: { surface: 'history', delta: trimmed.remaining }, boundary: trimmed.state };
}
