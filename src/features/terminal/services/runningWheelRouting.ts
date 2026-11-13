import type { Terminal } from '@xterm/xterm';
import { getCellMetrics } from '@utils/termMetrics';
import { isTerminalDebugEnabled, terminalDebug } from './terminalDebug';
import {
  isHistoryAtBottom,
  routeRunningWheel,
  WHEEL_GESTURE_IDLE,
  type WheelGestureState,
} from '../model/runningWheel';

/**
 * One wheel gesture's state for a pane's command history and its running block terminal.
 *
 * The listener belongs to the history scroller rather than to the live terminal's host: during
 * one continuous gesture the pointer keeps addressing different elements as the content moves,
 * so a handler bound to the terminal would miss the events between them and swallow them.
 */
interface RoutingState extends WheelGestureState {
  /** Unconsumed wheel distance not yet worth a whole terminal row. */
  residual: number;
}

/** Wheel distance on the history surface for a browser wheel event. */
function historyDistance(event: WheelEvent, scroll: HTMLElement): number {
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return event.deltaY * scroll.clientHeight;
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
    return event.deltaY * (parseFloat(getComputedStyle(scroll).lineHeight) || 16);
  }
  return event.deltaY;
}

/** Wheel distance in px on the live terminal surface, converted from the event's unit. */
function terminalDistance(event: WheelEvent, term: Terminal, lineHeight: number): number {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return event.deltaY * lineHeight;
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return event.deltaY * lineHeight * term.rows;
  return event.deltaY;
}

/** Move the live terminal by a pixel distance, keeping the sub-row remainder for the next event. */
function scrollTerminal(term: Terminal, delta: number, lineHeight: number, state: RoutingState): void {
  const direction = Math.sign(delta);
  if (direction !== Math.sign(state.residual)) state.residual = 0;
  state.residual += delta;
  const lines = Math.trunc(state.residual / lineHeight);
  if (lines === 0) return;
  const buffer = term.buffer.active;
  const maxLines = direction < 0 ? buffer.viewportY : buffer.baseY - buffer.viewportY;
  const applied = direction < 0 ? Math.max(lines, -maxLines) : Math.min(lines, maxLines);
  if (applied === 0) {
    state.residual = 0;
    return;
  }
  term.scrollLines(applied);
  state.residual -= applied * lineHeight;
}

/**
 * Route wheel input over a pane's command history to the live terminal or the history.
 *
 * The decision never depends on the pointer alone: content moves under the pointer during a
 * gesture, so an event addressed to another element still has to reach the running terminal
 * once the history has nothing left in that direction. Reading history stays ordinary native
 * scrolling while a surface can still move; when it cannot, the movement is handed on instead
 * of being swallowed. Scrolling down unwinds the remaining history first and then the live
 * terminal, because scrolling down is what brings the full running screen back into view;
 * scrolling up reads the live scrollback first. Returns the cleanup that removes the listener.
 */
export function installRunningWheelRouting(scroll: HTMLElement, getTerm: () => Terminal | null): () => void {
  const state: RoutingState = { ...WHEEL_GESTURE_IDLE, residual: 0 };
  if (isTerminalDebugEnabled()) terminalDebug('running-wheel-routing-installed', { paneId: scroll.dataset.testid ?? null });
  const onWheel = (event: WheelEvent) => {
    // A horizontal-only gesture is not vertical wheel input.
    if (event.deltaY === 0) return;
    const term = getTerm();
    if (!term) return;
    // Programs that own their own wheel input keep receiving it natively.
    if (term.modes.mouseTrackingMode !== 'none' || term.buffer.active.type === 'alternate') {
      state.residual = 0;
      state.historyEndReached = false;
      return;
    }
    const overTerminal = event.target instanceof Element
      && event.target.closest('[data-testid="running-term"]') !== null;
    const historyCanMove = event.deltaY > 0 ? !isHistoryAtBottom(scroll) : scroll.scrollTop > 0;
    if (!overTerminal && historyCanMove) {
      // Reading the history with the pointer away from the running block stays native.
      state.residual = 0;
      state.historyEndReached = false;
      state.boundary = WHEEL_GESTURE_IDLE.boundary;
      return;
    }
    const lineHeight = Math.max(1, getCellMetrics(term).height);
    const decided = routeRunningWheel({
      position: term.buffer.active,
      historyScrollable: !isHistoryAtBottom(scroll),
      delta: terminalDistance(event, term, lineHeight),
      historyDelta: historyDistance(event, scroll),
    }, state);
    state.boundary = decided.state.boundary;
    state.historyEndReached = decided.state.historyEndReached;
    const { route } = decided;
    if (isTerminalDebugEnabled()) {
      terminalDebug('running-wheel-route', {
        surface: route.surface,
        deltaY: event.deltaY,
        deltaMode: event.deltaMode,
        overTerminal,
        historyCanMove,
        viewportY: term.buffer.active.viewportY,
        baseY: term.buffer.active.baseY,
        historyTop: Math.round(scroll.scrollTop),
        historyMax: Math.round(scroll.scrollHeight - scroll.clientHeight),
        historyEndReached: state.historyEndReached,
        applied: route.surface === 'history' ? Math.round(route.delta) : null,
      });
    }
    if (route.surface === 'history') {
      event.preventDefault();
      event.stopPropagation();
      state.residual = 0;
      scroll.scrollTop += route.delta;
      if (!state.historyEndReached && isHistoryAtBottom(scroll)) state.historyEndReached = true;
      return;
    }
    if (route.surface === 'boundary') {
      event.preventDefault();
      event.stopPropagation();
      state.residual = 0;
      return;
    }
    // The live terminal keeps the movement. Apply it here rather than letting the event through:
    // xterm only sees wheel input over its own element, and the pointer is elsewhere whenever
    // the history moved content out from under it.
    event.preventDefault();
    event.stopPropagation();
    scrollTerminal(term, terminalDistance(event, term, lineHeight), lineHeight, state);
  };
  scroll.addEventListener('wheel', onWheel, { capture: true, passive: false });
  return () => scroll.removeEventListener('wheel', onWheel, { capture: true });
}
