import { describe, expect, it } from 'vitest';
import { showsPaneChatHistory } from '../paneHistory';

describe('showsPaneChatHistory', () => {
  it('keeps local history in the classic scene only', () => {
    expect(showsPaneChatHistory('classic', 'local')).toBe(true);
    expect(showsPaneChatHistory('blockList', 'local')).toBe(false);
    expect(showsPaneChatHistory('altScreen', 'local')).toBe(false);
  });

  it('never stacks SSH history on the connection surface', () => {
    expect(showsPaneChatHistory('classic', 'ssh')).toBe(false);
    expect(showsPaneChatHistory('blockList', 'ssh')).toBe(false);
    expect(showsPaneChatHistory('altScreen', 'ssh')).toBe(false);
  });
});
