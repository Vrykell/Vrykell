/**
 * Temporary probe for the chat transcript jump — remove once the cause is known.
 *
 * Counts, per second, how often the panel renders and how the transcript's scroll events divide
 * between the app following the bottom and the reader moving the view. Metadata only: counts, never
 * message text or geometry beyond what an event already carries.
 */
import { terminalDebug } from '@platform/diagnostics';

const WINDOW_MS = 1000;

export const chatScrollProbe = {
  renders: 0,
  scrolls: 0,
  ours: 0,
  followOn: 0,
  followOff: 0,
  at: Date.now(),
  on() { this.followOn += 1; },
  off() { this.followOff += 1; },
  /** Write at most one line a second, and only when something happened at all. */
  tick() {
    const now = Date.now();
    const ms = now - this.at;
    if (ms < WINDOW_MS) return;
    if (this.renders > 0 || this.scrolls > 0) {
      terminalDebug('chat-scroll-probe', {
        ms, renders: this.renders, scrolls: this.scrolls, ours: this.ours,
        followOn: this.followOn, followOff: this.followOff,
      });
    }
    this.renders = 0;
    this.scrolls = 0;
    this.ours = 0;
    this.followOn = 0;
    this.followOff = 0;
    this.at = now;
  },
};
