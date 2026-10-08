import { fmtDuration } from '@ui/UiBtn';

/** Keep sub-minute durations precise without dominating the command context. */
export function formatCommandDuration(milliseconds: number): string {
  return milliseconds < 60000 ? `${(Math.max(0, milliseconds) / 1000).toFixed(3)}s` : fmtDuration(milliseconds);
}
