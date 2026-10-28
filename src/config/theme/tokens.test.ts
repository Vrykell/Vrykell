import { describe, it, expect, afterEach } from 'vitest';
import {
  hexToRgba,
  toRgba,
  setThemeOverrides,
  applyTheme,
  getCurrentTheme,
  getThemeOverrides,
  paletteToCssVars,
  readThemePreference,
  persistThemePreference,
  resolveThemeMode,
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

describe('default blue palette', () => {
  it.each(['dark', 'light'] as const)('%s separates vivid destructive controls from muted diagnostic text', mode => {
    expect(themes[mode].dangerAction).not.toBe(themes[mode].errorLight);
    expect(paletteToCssVars(themes[mode])['--danger-action']).toBe(themes[mode].dangerAction);
    expect(paletteToCssVars(themes[mode])['--danger-action-text']).toBe(themes[mode].dangerActionText);
  });
  it('keeps favorites yellow in both themes instead of reusing the darkened light group color', () => {
    expect(paletteToCssVars(themes.dark)['--favorite-color']).toBe('#F5C400');
    expect(paletteToCssVars(themes.light)['--favorite-color']).toBe('#F5C400');
  });
  it('uses the sampled neutral surfaces and blue action from the appearance reference', () => {
    expect(themes.dark).toMatchObject({
      canvas: '#202020', sidebarBg: '#28282B', chromeBg: '#2E2E2E', auxiliaryBg: '#282828', xtermBg: '#141414', surface: '#282828', composerBg: '#333333',
      fieldBg: '#3C3C3C', elevated: '#303030', selectionBg: '#484848', accent: '#50C0FF', primaryAction: '#2C67C5', shellZshAccent: '#F15A24',
    });
  });
  it.each(['dark', 'light'] as const)('%s reuses the neutral card and field colors for content blocks', mode => {
    const palette = themes[mode];
    expect(palette.block).toBe(palette.surface);
    expect(palette.commandBlockBg).toBe(palette.surface);
    expect(palette.aiBlockBg).toBe(palette.surface);
    expect(palette.codeBg).toBe(palette.fieldBg);
  });
  it.each(['dark', 'light'] as const)('%s uses one green family across status, icons, groups and terminal output', mode => {
    const palette = themes[mode];
    const green = mode === 'dark' ? '#30D158' : '#167C32';
    for (const color of [palette.success, palette.shellConnected, palette.groupGreen, palette.xtermGreen, palette.xtermBrightGreen, palette.cmdProgram]) expect(color).toBe(green);
  });
  it.each(['dark', 'light'] as const)('%s primary actions use the unified action blue', mode => {
    expect(themes[mode].primaryAction).toBe('#2C67C5');
    expect(paletteToCssVars(themes[mode])['--primary-action']).toBe(themes[mode].primaryAction);
  });
  it.each(['dark', 'light'] as const)('%s keeps blue text carets separate from terminal cursors', mode => {
    const cursor = themes[mode].textCaret;
    const channels = [1, 3, 5].map(offset => parseInt(cursor.slice(offset, offset + 2), 16));
    expect(channels[2]).toBeGreaterThan(channels[1]!);
    expect(channels[1]).toBeGreaterThan(channels[0]!);
    expect(paletteToCssVars(themes[mode])['--text-caret']).toBe(cursor);
    expect(paletteToCssVars(themes[mode])['--xterm-cursor']).toBe(mode === 'dark' ? '#E9EBED' : '#2E3742');
  });
  it.each(['dark', 'light'] as const)('%s command colors stay legible on input and output backgrounds', mode => {
    const palette = themes[mode];
    const luminance = (hex: string) => {
      const values = [1, 3, 5].map(offset => {
        const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return values[0]! * 0.2126 + values[1]! * 0.7152 + values[2]! * 0.0722;
    };
    for (const color of [palette.cmdProgram, palette.cmdArgument, palette.cmdFlag, palette.cmdPath,
      palette.cmdNumber, palette.cmdVariable, palette.cmdString, palette.cmdPipe]) {
      for (const background of [palette.fieldBg, palette.composerBg, palette.xtermBg]) {
        const values = [luminance(color), luminance(background)];
        expect((Math.max(...values) + 0.05) / (Math.min(...values) + 0.05)).toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(paletteToCssVars(palette)['--cmd-program']).toBe(palette.cmdProgram);
  });
  it.each(['dark', 'light'] as const)('%s syntax colors retain strong color rather than pale tints', mode => {
    const palette = themes[mode];
    for (const color of [palette.cmdProgram, palette.cmdArgument, palette.cmdNumber, palette.cmdVariable,
      palette.cmdFlag, palette.cmdPath, palette.cmdPipe, palette.cmdRedirect, palette.cmdString]) {
      const channels = [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16));
      const maximum = Math.max(...channels);
      // The raised composer surface needs a lighter violet; 0.50 still reads as a vivid hue.
      expect((maximum - Math.min(...channels)) / maximum).toBeGreaterThanOrEqual(0.50);
    }
  });
  it.each(['dark', 'light'] as const)('%s shares accent families between syntax and color pickers', mode => {
    const palette = themes[mode];
    expect(palette.groupBlue).toBe(palette.cmdArgument);
    expect(palette.groupGreen).toBe(palette.cmdProgram);
    expect(palette.groupViolet).toBe(palette.cmdPipe);
    expect(palette.groupAmber).toBe(palette.cmdNumber);
    expect(palette.groupCyan).toBe(palette.cmdPath);
    expect(palette.groupOrange).toBe(palette.cmdString);
  });
  it('both dark and light exist', () => {
    expect(themes.dark).toBeDefined();
    expect(themes.light).toBeDefined();
  });

  it.each(['dark', 'light'] as const)('%s uses blue interactive accents and a distinct warm accent', (mode) => {
    const accent = themes[mode].accent;
    expect(accent.startsWith('#')).toBe(true);
    const [r, g, b] = [
      parseInt(accent.slice(1, 3), 16),
      parseInt(accent.slice(3, 5), 16),
      parseInt(accent.slice(5, 7), 16),
    ];
    expect(b).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(r);
    const warm = themes[mode].accentWarm;
    expect(parseInt(warm.slice(1, 3), 16)).toBeGreaterThan(parseInt(warm.slice(5, 7), 16));
  });

  it.each(['dark', 'light'] as const)('%s keeps editable fields distinct from panels with a restrained brightness step', mode => {
    const panel = themes[mode].surface;
    const field = themes[mode].fieldBg;
    const primary = themes[mode].textPrimary;
    const channel = (hex: string) => parseInt(hex.slice(1, 3), 16);
    expect(channel(field)).not.toBe(channel(panel));
    expect(Math.abs(channel(field) - channel(panel))).toBeLessThanOrEqual(24);
    const luminance = (hex: string) => {
      const value = channel(hex) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    };
    const values = [luminance(primary), luminance(field)];
    expect((Math.max(...values) + 0.05) / (Math.min(...values) + 0.05)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(['dark', 'light'] as const)('%s separates navigation and content surfaces', mode => {
    const palette = themes[mode];
    expect(palette.chromeBg).not.toBe(palette.auxiliaryBg);
    expect(palette.sidebarBg).not.toBe(palette.canvas);
    expect(palette.canvas).not.toBe(palette.surface);
    expect(palette.fieldBg).not.toBe(palette.surface);
    expect(palette.chromeField).not.toBe(palette.chromeBg);
  });

  it('dark field hover increases brightness instead of exposing the darker panel underneath', () => {
    expect(parseInt(themes.dark.buttonHover.slice(1, 3), 16))
      .toBeGreaterThan(parseInt(themes.dark.fieldBg.slice(1, 3), 16));
  });

  it.each(['dark', 'light'] as const)('%s dropdown hover and expanded backgrounds remain neutral', mode => {
    for (const color of [themes[mode].hover, themes[mode].buttonHover]) {
      const channels = color.startsWith('#') ? [color.slice(1, 3), color.slice(3, 5), color.slice(5, 7)] : color.match(/\d+/g)!.slice(0, 3);
      expect(new Set(channels).size).toBe(1);
    }
  });

  it('dark keeps semantic colors (success/error/warning)', () => {
    expect(themes.dark.success).toBe('#30D158');
    expect(themes.dark.error).toBe('#F14C4C');
    expect(themes.dark.warning).toBe('#D5AD54');
  });

  it.each(['dark', 'light'] as const)('%s retains navigation tint and distinct content, auxiliary and composer surfaces', mode => {
    if (mode === 'dark') expect(themes[mode].chromeBg).not.toBe(themes[mode].sidebarBg);
    else expect(themes[mode].chromeBg).toBe(themes[mode].sidebarBg);
    expect(themes[mode].auxiliaryBg).not.toBe(themes[mode].canvas);
    expect(themes[mode].sidebarBg).not.toBe(themes[mode].canvas);
    expect(themes[mode].fieldBg).not.toBe(themes[mode].canvas);
    expect(paletteToCssVars(themes[mode])['--composer-bg']).toBe(mode === 'dark' ? '#333333' : '#FFFFFF');
  });
  it('retains the complete terminal color palette', () => {
    expect(themes.dark.xtermForeground).toBe('#E9EBED');
    expect(themes.dark.xtermBlue).toBe('#8DB7E8');
    expect(themes.dark.xtermBrightRed).toBe('#FF9A92');
  });

  it.each(['dark', 'light'] as const)('%s keeps text readable on resting and active surfaces', mode => {
    const palette = themes[mode];
    const luminance = (hex: string) => {
      const channels = [1, 3, 5].map(offset => {
        const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    for (const text of [palette.textPrimary, palette.textSecondary, palette.textMuted]) {
      for (const surface of [palette.chromeBg, palette.canvas, palette.surface, palette.cardBg, palette.fieldBg, palette.elevated, palette.selectionBg, palette.buttonHover]) {
        const values = [luminance(text), luminance(surface)];
        expect((Math.max(...values) + 0.05) / (Math.min(...values) + 0.05)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
  it.each(['dark', 'light'] as const)('%s gives borderless cards enough separation from the canvas', mode => {
    const palette = themes[mode];
    const luminance = (hex: string) => [1, 3, 5].map(offset => {
      const channel = parseInt(hex.slice(offset, offset + 2), 16) / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
    const values = [luminance(palette.cardBg), luminance(palette.canvas)];
    expect((Math.max(...values) + 0.05) / (Math.min(...values) + 0.05)).toBeGreaterThanOrEqual(1.12);
    expect(paletteToCssVars(palette)['--card-bg']).toBe(palette.cardBg);
    expect(luminance(palette.fieldBg)).toBeGreaterThan(luminance(palette.cardBg));
  });
  it.each(['dark', 'light'] as const)('%s keeps row selection neutral without recoloring primary actions', mode => {
    const palette = themes[mode];
    const channels = [1, 3, 5].map(offset => parseInt(palette.selectionBg.slice(offset, offset + 2), 16));
    expect(new Set(channels).size).toBe(1);
    expect(palette.primaryAction).toBe('#2C67C5');
  });
});

describe('paletteToCssVars', () => {
  it.each(['dark', 'light'] as const)('%s provides distinct, readable categorical group colors', mode => {
    const vars = paletteToCssVars(themes[mode]);
    const colors = ['blue', 'green', 'violet', 'amber', 'cyan', 'rose', 'orange', 'coral'].map(color => vars[`--group-${color}`]);
    expect(new Set(colors).size).toBe(colors.length);
    const luminance = (hex: string) => {
      const channels = [1, 3, 5].map(offset => {
        const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    for (const color of colors) {
      const values = [luminance(color), luminance(themes[mode].surface)];
      expect((Math.max(...values) + 0.05) / (Math.min(...values) + 0.05)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(['dark', 'light'] as const)('%s uses a cool frame and separates navigation from content', (mode) => {
    const vars = paletteToCssVars(themes[mode]);
    for (const key of ['--chrome-bg', '--sidebar-bg', '--chrome-field', '--selection-bg', '--canvas', '--surface', '--field-bg', '--block', '--elevated', '--border', '--border-strong', '--text-primary', '--text-secondary', '--text-muted', '--xterm-bg']) {
      expect(vars[key]).toMatch(/^#[0-9a-f]{6}$/i);
      const channels = [1, 3, 5].map(offset => parseInt(vars[key].slice(offset, offset + 2), 16));
      expect(channels[2]).toBeGreaterThanOrEqual(channels[0]!);
    }
    if (mode === 'dark') expect(vars['--sidebar-bg']).not.toBe(vars['--chrome-bg']);
    else expect(vars['--sidebar-bg']).toBe(vars['--chrome-bg']);
    expect(vars['--auxiliary-bg']).not.toBe(vars['--chrome-bg']);
    expect(vars['--sidebar-bg']).not.toBe(vars['--canvas']);
  });
  it.each(['dark', 'light'] as const)('%s separates window chrome, content, fields and selection', (mode) => {
    const vars = paletteToCssVars(themes[mode]);
    expect(vars['--chrome-bg']).toBeTruthy();
    expect(vars['--chrome-field']).toBeTruthy();
    expect(vars['--selection-bg']).toBeTruthy();
    expect(vars['--sidebar-bg']).not.toBe(vars['--canvas']);
    expect(vars['--chrome-field']).not.toBe(vars['--chrome-bg']);
    expect(vars['--surface']).not.toBe(vars['--canvas']);
  });
  it('covers every ThemePalette field', () => {
    const vars = paletteToCssVars(themes.dark);
    const fields = Object.keys(themes.dark);
    // Every palette field should have a matching CSS variable
    for (const f of fields) {
      expect(vars[`--${camelToKebab(f)}`] ?? vars[`--${f}`]).toBeDefined();
    }
  });

  it('generated variables match palette values', () => {
    const vars = paletteToCssVars(themes.dark);
    expect(vars['--canvas']).toBe(themes.dark.canvas);
    expect(vars['--accent']).toBe(themes.dark.accent);
  });
});

describe('appearance preference', () => {
  afterEach(() => { localStorage.clear(); });

  it('resolves a stored choice, following the operating system for "system"', () => {
    expect(resolveThemeMode('dark')).toBe('dark');
    expect(resolveThemeMode('light')).toBe('light');
    // The jsdom matchMedia stub reports a light system appearance.
    expect(resolveThemeMode('system')).toBe('light');
  });

  it('round-trips the stored preference and defaults to dark', () => {
    expect(readThemePreference()).toBe('dark');
    persistThemePreference('system');
    expect(readThemePreference()).toBe('system');
    persistThemePreference('light');
    expect(readThemePreference()).toBe('light');
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
    // Variables without an override keep the base value
    expect(document.documentElement.style.getPropertyValue('--surface')).toBe(themes.dark.surface);
  });

  it('keeps field overrides independent of the panel and terminal palettes', () => {
    setThemeOverrides({ '--field-bg': '#343434' });
    applyTheme('dark');
    expect(document.documentElement.style.getPropertyValue('--field-bg')).toBe('#343434');
    expect(document.documentElement.style.getPropertyValue('--surface')).toBe(themes.dark.surface);
    expect(document.documentElement.style.getPropertyValue('--xterm-bg')).toBe(themes.dark.xtermBg);
  });

  it('applies base only when overrides empty', () => {
    setThemeOverrides({});
    applyTheme('dark');
    expect(document.documentElement.style.getPropertyValue('--canvas')).toBe(themes.dark.canvas);
  });

  it('writes data-theme and updates getCurrentTheme', () => {
    applyTheme('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(getCurrentTheme()).toBe('light');
  });

  it('getThemeOverrides returns the current override table', () => {
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

describe('TEAL_THEME_PRESET (custom teal theme)', () => {
  it('every key is a valid variable generated by paletteToCssVars', () => {
    const vars = paletteToCssVars(themes.dark);
    for (const k of Object.keys(TEAL_THEME_PRESET)) {
      expect(vars[k]).toBeDefined();
    }
  });

  it('overrides only hue variables, never neutral structural variables', () => {
    const structural = [
      '--canvas', '--surface', '--block', '--elevated', '--border',
      '--border-strong', '--overlay', '--overlay-light',
    ];
    for (const s of structural) {
      expect(TEAL_THEME_PRESET[s]).toBeUndefined();
    }
  });

  it('can layer on top of the default neutrals once applied', () => {
    setThemeOverrides(TEAL_THEME_PRESET);
    applyTheme('dark');
    // Structural variables still come from the default
    expect(document.documentElement.style.getPropertyValue('--canvas')).toBe(themes.dark.canvas);
    // Hue variables are overridden by the preset
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe(TEAL_THEME_PRESET['--accent']);
  });
});

function camelToKebab(s: string): string {
  return s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}
