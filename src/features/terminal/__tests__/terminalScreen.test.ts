import { describe, expect, it } from 'vitest';
import { captureTerminalOutput } from '../model/terminalSnapshot';

describe('interactive screen attributes', () => {
  it('preserves reverse video with default colors and escapes remote markup', async () => {
    const screen = await captureTerminalOutput('\x1b[7m选中 <script>\x1b[27m', 80);
    expect(screen.html).toContain('color:var(--canvas)');
    expect(screen.html).toContain('background:var(--text-primary)');
    expect(screen.html).toContain('&lt;script&gt;');
    expect(screen.html).not.toContain('<script>');
  });
});
