import { describe, expect, it } from 'vitest';
import { formatMessageTime } from './formatTime';

describe('formatMessageTime', () => {
  it('renders the clock time of a timestamp in the reader locale', () => {
    const noon = new Date(2026, 9, 14, 13, 5).getTime();
    const value = formatMessageTime(noon);
    // Locale decides between 24h and AM/PM, so assert the shape rather than one wording.
    expect(value).toMatch(/^(13:05|0?1:05\s?PM)$/);
  });

  it('keeps a stable shape for the first minute of the epoch', () => {
    expect(formatMessageTime(0)).toMatch(/^\d{1,2}:\d{2}(\s?[AP]M)?$/);
  });
});
