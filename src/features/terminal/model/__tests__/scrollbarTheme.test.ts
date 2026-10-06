import { afterEach, describe, expect, it } from 'vitest';
import { applyTheme, setThemeOverrides } from '@config/theme/tokens';
import { readXtermTheme } from '../xtermTheme';

afterEach(() => { setThemeOverrides({}); applyTheme('dark'); });

describe('terminal scrollbar theme', () => {
  it.each(['dark', 'light'] as const)('shares the %s palette with native content scrollbars', mode => {
    applyTheme(mode);
    const styles = getComputedStyle(document.documentElement);
    const theme = readXtermTheme();
    expect(theme.scrollbarSliderBackground).toBe(styles.getPropertyValue('--scrollbar-thumb').trim());
    expect(theme.scrollbarSliderHoverBackground).toBe(styles.getPropertyValue('--scrollbar-thumb-hover').trim());
    expect(theme.scrollbarSliderActiveBackground).toBe(theme.scrollbarSliderHoverBackground);
    expect(theme.overviewRulerBorder).toBe(theme.background);
  });

  it('respects custom scrollbar colors for newly created terminal instances', () => {
    setThemeOverrides({ '--scrollbar-thumb': '#556677', '--scrollbar-thumb-hover': '#778899' });
    applyTheme('dark');
    expect(readXtermTheme()).toMatchObject({
      scrollbarSliderBackground: '#556677',
      scrollbarSliderHoverBackground: '#778899',
      scrollbarSliderActiveBackground: '#778899',
    });
  });
});
