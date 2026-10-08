import { describe, it, expect, afterEach } from 'vitest';
import {
  hexToRgba,
  toRgba,
  setThemeOverrides,
  applyTheme,
  getCurrentTheme,
  getThemeOverrides,
  paletteToCssVars,
  themes,
  TEAL_THEME_PRESET,
} from '@config/theme/tokens';

describe('hexToRgba', () => {
  it('converts 3-digit and 6-digit hex to rgba', () => {
    expect(hexToRgba('#fff', 0.5)).toBe('rgba(255, 255, 255, 0.5)');
    expect(hexToRgba('#101010', 1)).toBe('rgba(16, 16, 16, 1)');
  });

  it('falls back to black on invalid input', () => {
    expect(hexToRgba('not-a-color', 0.9)).toBe('rgba(0, 0, 0, 0.9)');
    expect(hexToRgba('#12345', 0.5)).toBe('rgba(0, 0, 0, 0.5)');
  });
});

describe('toRgba', () => {
  it('converts hex / rgb / rgba with given alpha', () => {
    expect(toRgba('#050505', 0.9)).toBe('rgba(5, 5, 5, 0.9)');
    expect(toRgba('rgb(1, 2, 3)', 0.5)).toBe('rgba(1, 2, 3, 0.5)');
    expect(toRgba('rgba(10, 20, 30, 0.8)', 0.4)).toBe('rgba(10, 20, 30, 0.4)');
  });

  it('returns unrecognized colors unchanged', () => {
    expect(toRgba('currentColor', 0.5)).toBe('currentColor');
  });
});

describe('默认调色板（中性灰色）', () => {
  it('dark 与 light 均存在', () => {
    expect(themes.dark).toBeDefined();
    expect(themes.light).toBeDefined();
  });

  it.each(['dark', 'light'] as const)('%s uses neutral interactive accents', (mode) => {
    const accent = themes[mode].accent;
    expect(accent.startsWith('#')).toBe(true);
    const [r, g, b] = [
      parseInt(accent.slice(1, 3), 16),
      parseInt(accent.slice(3, 5), 16),
      parseInt(accent.slice(5, 7), 16),
    ];
    expect(r).toBe(g);
    expect(g).toBe(b);
    const warm = themes[mode].accentWarm;
    expect(warm.slice(1, 3)).toBe(warm.slice(3, 5));
    expect(warm.slice(3, 5)).toBe(warm.slice(5, 7));
  });

  it('dark 语义色保留（成功/错误/警告）', () => {
    expect(themes.dark.success).toBe('#89D185');
    expect(themes.dark.error).toBe('#F14C4C');
    expect(themes.dark.warning).toBe('#CCA700');
  });

  it('终端表面与应用外壳分层，并提供完整 ANSI 色板', () => {
    expect(themes.dark.xtermBg).not.toBe(themes.dark.canvas);
    expect(themes.dark.xtermForeground).toBe('#ECEFF4');
    expect(themes.dark.xtermBlue).toBe('#8DB7E8');
    expect(themes.dark.xtermBrightRed).toBe('#FF9A92');
  });

  it('keeps dark-theme body and secondary text readable on every shared surface', () => {
    const luminance = (hex: string) => {
      const channels = [1, 3, 5].map(offset => {
        const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    for (const text of [themes.dark.textPrimary, themes.dark.textSecondary, themes.dark.textMuted]) {
      for (const surface of [themes.dark.chromeBg, themes.dark.sidebarBg, themes.dark.canvas, themes.dark.surface, themes.dark.block, themes.dark.elevated]) {
        expect((luminance(text) + 0.05) / (luminance(surface) + 0.05)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe('paletteToCssVars', () => {
  it.each(['dark', 'light'] as const)('%s uses neutral grays and separates primary navigation from sidebars', (mode) => {
    const vars = paletteToCssVars(themes[mode]);
    for (const key of ['--chrome-bg', '--sidebar-bg', '--chrome-field', '--selection-bg', '--canvas', '--surface', '--block', '--elevated', '--border', '--border-strong', '--text-primary', '--text-secondary', '--text-muted']) {
      expect(vars[key]).toMatch(/^#[0-9a-f]{6}$/i);
      const channels = [1, 3, 5].map(offset => parseInt(vars[key].slice(offset, offset + 2), 16));
      expect(new Set(channels).size).toBe(1);
    }
    expect(vars['--sidebar-bg']).not.toBe(vars['--chrome-bg']);
    expect(vars['--sidebar-bg']).not.toBe(vars['--canvas']);
  });
  it.each(['dark', 'light'] as const)('%s separates window chrome, content, fields and selection', (mode) => {
    const vars = paletteToCssVars(themes[mode]);
    expect(vars['--chrome-bg']).toBeTruthy();
    expect(vars['--chrome-field']).toBeTruthy();
    expect(vars['--selection-bg']).toBeTruthy();
    expect(vars['--chrome-bg']).not.toBe(vars['--canvas']);
    expect(vars['--chrome-field']).not.toBe(vars['--chrome-bg']);
    expect(vars['--surface']).not.toBe(vars['--canvas']);
  });
  it('覆盖 ThemePalette 全部字段', () => {
    const vars = paletteToCssVars(themes.dark);
    const fields = Object.keys(themes.dark);
    // 每个 palette 字段都应有对应 CSS 变量
    for (const f of fields) {
      expect(vars[`--${camelToKebab(f)}`] ?? vars[`--${f}`]).toBeDefined();
    }
  });

  it('生成变量与 palette 值一致', () => {
    const vars = paletteToCssVars(themes.dark);
    expect(vars['--canvas']).toBe(themes.dark.canvas);
    expect(vars['--accent']).toBe(themes.dark.accent);
  });
});

describe('theme overrides', () => {
  afterEach(() => {
    setThemeOverrides({});
    applyTheme('dark');
  });

  it('merges overrides over base palette', () => {
    setThemeOverrides({ '--canvas': '#ff0000' });
    applyTheme('dark');
    expect(document.documentElement.style.getPropertyValue('--canvas')).toBe('#ff0000');
    // 未覆盖的变量保持 base
    expect(document.documentElement.style.getPropertyValue('--surface')).toBe(themes.dark.surface);
  });

  it('applies base only when overrides empty', () => {
    setThemeOverrides({});
    applyTheme('dark');
    expect(document.documentElement.style.getPropertyValue('--canvas')).toBe(themes.dark.canvas);
  });

  it('写入 data-theme 并更新 getCurrentTheme', () => {
    applyTheme('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(getCurrentTheme()).toBe('light');
  });

  it('getThemeOverrides 返回当前覆盖表', () => {
    setThemeOverrides({ '--accent': '#57D4C2' });
    expect(getThemeOverrides()).toEqual({ '--accent': '#57D4C2' });
  });

  it('switches every structural color together and preserves an explicit chrome override', () => {
    setThemeOverrides({ '--chrome-bg': '#243043' });
    applyTheme('dark');
    const darkSelection = document.documentElement.style.getPropertyValue('--selection-bg');
    applyTheme('light');
    expect(document.documentElement.style.getPropertyValue('--chrome-bg')).toBe('#243043');
    expect(document.documentElement.style.getPropertyValue('--selection-bg')).not.toBe(darkSelection);
    expect(document.documentElement.style.getPropertyValue('--canvas')).toBe(themes.light.canvas);
  });

  it('removes obsolete custom aliases when restoring the default theme', () => {
    setThemeOverrides({ '--text-title': '#FFFFFF', '--tab-hover': '#303030' });
    applyTheme('dark');
    setThemeOverrides({});
    applyTheme('light');
    expect(document.documentElement.style.getPropertyValue('--text-title')).toBe('');
    expect(document.documentElement.style.getPropertyValue('--tab-hover')).toBe('');
  });
});

describe('TEAL_THEME_PRESET（青绿自定义主题）', () => {
  it('全部键都是 paletteToCssVars 生成的合法变量', () => {
    const vars = paletteToCssVars(themes.dark);
    for (const k of Object.keys(TEAL_THEME_PRESET)) {
      expect(vars[k]).toBeDefined();
    }
  });

  it('只覆盖带色相变量，不触碰中性结构变量', () => {
    const structural = [
      '--canvas', '--surface', '--block', '--elevated', '--border',
      '--border-strong', '--overlay', '--overlay-light',
    ];
    for (const s of structural) {
      expect(TEAL_THEME_PRESET[s]).toBeUndefined();
    }
  });

  it('应用后可叠加在默认中性之上', () => {
    setThemeOverrides(TEAL_THEME_PRESET);
    applyTheme('dark');
    // 结构变量仍来自默认
    expect(document.documentElement.style.getPropertyValue('--canvas')).toBe(themes.dark.canvas);
    // 色相变量被预设覆盖
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe(TEAL_THEME_PRESET['--accent']);
  });
});

function camelToKebab(s: string): string {
  return s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}
