import { afterEach, describe, expect, it } from 'vitest';
import { createBlockTerm, extractSnapshotFromBuffer } from '../model/terminalSnapshot';
import { readXtermTheme } from '../model/xtermTheme';

afterEach(() => {
  document.documentElement.style.removeProperty('--canvas');
  document.documentElement.style.removeProperty('--xterm-bg');
});

describe('shared terminal background', () => {
  it('uses the classic terminal color for running blocks and follows later theme changes', async () => {
    document.documentElement.style.setProperty('--canvas', '#141414');
    document.documentElement.style.setProperty('--xterm-bg', '#112233');
    const block = createBlockTerm(80, 24);
    try {
      expect(block.term.options.theme?.background).toBe(readXtermTheme().background);
      expect(block.el.style.background).toBe('var(--xterm-bg)');
      document.documentElement.style.setProperty('--xterm-bg', '#f8f9fb');
      await new Promise<void>(resolve => queueMicrotask(resolve));
      expect(block.term.options.theme?.background).toBe('#f8f9fb');
    } finally { block.dispose(); }
  });

  it('uses the terminal background for default inverse text while retaining explicit ANSI colors', async () => {
    const block = createBlockTerm(80, 24);
    try {
      await new Promise<void>(resolve => block.term.write('\x1b[7mselected\x1b[0m \x1b[48;2;1;2;3mcolored\x1b[0m', resolve));
      const snapshot = extractSnapshotFromBuffer(block.term.buffer.active, 80);
      expect(snapshot.html).toContain('color:var(--xterm-bg)');
      expect(snapshot.html).toContain('background:#010203');
    } finally { block.dispose(); }
  });
});
