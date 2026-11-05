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
