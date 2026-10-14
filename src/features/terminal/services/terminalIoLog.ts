import type { DispatchEvent } from '@core/terminal/events';
import { isTerminalDebugEnabled, terminalDebug } from './terminalDebug';

/**
 * Time span one aggregated record covers. A full-screen program sends an output batch per frame,
 * and each batch is counted again at every stage it passes; a per-chunk record multiplied that
 * traffic and buried everything else in the log. The window keeps the same readings — how much
 * arrived, how much reached the controller, where every part of it went — in one record per second.
 */
export const TERMINAL_IO_WINDOW_MS = 1000;

/** Where a data chunk can be routed; the split mirrors the pipeline destinations. */
export type TerminalRouteTarget = 'main' | 'block' | 'early';

export interface TerminalRouteFlags {
  /** A block whose live terminal is not open yet: its output waits in the early buffer. */
  blockNotReady?: boolean;
  /** The command-echo filter was armed when this chunk arrived. */
  echoArmed?: boolean;
  /** The chunk matched the echoed command and was filtered out instead of shown. */
  echoFiltered?: boolean;
}

interface IoWindow {
  samples: number;
  start: number;
  scene: string | null;
  rxBatches: number;
  rxEvents: number;
  rxChars: number;
  rxOsc: number;
  rxAlt: number;
  ctlBatches: number;
  ctlEvents: number;
  mainChunks: number;
  mainChars: number;
  blockChunks: number;
  blockChars: number;
  earlyChunks: number;
  earlyChars: number;
  maxChars: number;
  blockNotReady: number;
  echoArmed: number;
  echoFiltered: number;
}

function emptyWindow(): IoWindow {
  return {
    samples: 0,
    start: 0,
    scene: null,
    rxBatches: 0,
    rxEvents: 0,
    rxChars: 0,
    rxOsc: 0,
    rxAlt: 0,
    ctlBatches: 0,
    ctlEvents: 0,
    mainChunks: 0,
    mainChars: 0,
    blockChunks: 0,
    blockChars: 0,
    earlyChunks: 0,
    earlyChars: 0,
    maxChars: 0,
    blockNotReady: 0,
    echoArmed: 0,
    echoFiltered: 0,
  };
}

/**
 * Windowed counters for the terminal pipeline of one pane: what the session received from the PTY,
 * what the controller took in, and where each data chunk went. A sample costs a few increments; the
 * open window is written as one `terminal-io` record once its second is over, or when the pane goes
 * away, so a stalled pipeline still leaves its last counters behind.
 */
export class TerminalIoLog {
  private window = emptyWindow();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly tabId: string) {}

  /** One batch of scan events as the session received it over IPC. */
  received(events: readonly DispatchEvent[]): void {
    if (!isTerminalDebugEnabled()) return;
    const window = this.open();
    window.rxBatches += 1;
    for (const event of events) {
      window.rxEvents += 1;
      if (event.kind === 'data') window.rxChars += event.text.length;
      else if (event.kind === 'osc') window.rxOsc += 1;
      else window.rxAlt += 1;
    }
  }

  /** One batch handed to the session controller. */
  consumed(events: readonly DispatchEvent[], scene: string): void {
    if (!isTerminalDebugEnabled()) return;
    const window = this.open();
    window.ctlBatches += 1;
    window.ctlEvents += events.length;
    window.scene = scene;
  }

  /** One data chunk handed to a sink. */
  routed(target: TerminalRouteTarget, chars: number, flags: TerminalRouteFlags = {}): void {
    if (!isTerminalDebugEnabled()) return;
    const window = this.open();
    if (target === 'main') {
      window.mainChunks += 1;
      window.mainChars += chars;
    } else if (target === 'block') {
      window.blockChunks += 1;
      window.blockChars += chars;
    } else {
      window.earlyChunks += 1;
      window.earlyChars += chars;
    }
    window.maxChars = Math.max(window.maxChars, chars);
    if (flags.blockNotReady) window.blockNotReady += 1;
    if (flags.echoArmed) window.echoArmed += 1;
    if (flags.echoFiltered) window.echoFiltered += 1;
  }

  /** Write the open window now; a pane that is going away keeps its last counters. */
  flush(): void {
    this.stopTimer();
    const window = this.window;
    if (window.samples === 0) return;
    this.window = emptyWindow();
    terminalDebug('terminal-io', {
      tabId: this.tabId,
      scene: window.scene,
      windowMs: Math.max(0, Date.now() - window.start),
      rxBatches: window.rxBatches,
      rxEvents: window.rxEvents,
      rxChars: window.rxChars,
      rxOsc: window.rxOsc,
      rxAlt: window.rxAlt,
      ctlBatches: window.ctlBatches,
      ctlEvents: window.ctlEvents,
      mainChunks: window.mainChunks,
      mainChars: window.mainChars,
      blockChunks: window.blockChunks,
      blockChars: window.blockChars,
      earlyChunks: window.earlyChunks,
      earlyChars: window.earlyChars,
      maxChars: window.maxChars,
      blockNotReady: window.blockNotReady,
      echoArmed: window.echoArmed,
      echoFiltered: window.echoFiltered,
    });
  }

  /** Drop the open window without writing it; used when the pane unmounts after a flush. */
  dispose(): void {
    this.stopTimer();
    this.window = emptyWindow();
  }

  private open(): IoWindow {
    if (this.window.samples === 0) {
      this.window.start = Date.now();
      this.timer = setTimeout(() => {
        this.timer = null;
        this.flush();
      }, TERMINAL_IO_WINDOW_MS);
    }
    this.window.samples += 1;
    return this.window;
  }

  private stopTimer(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }
}
