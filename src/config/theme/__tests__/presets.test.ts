import { afterEach, expect, it } from 'vitest';
import { contrast, resolveThemePreset, themePresets } from '../presets';
import { applyTheme, cacheThemePresets, getPresetPalette, paletteToCssVars, setThemeOverrides, themes } from '../tokens';

afterEach(() => { localStorage.removeItem('vrykell-theme-presets'); setThemeOverrides({}); applyTheme('dark'); });

it('preserves every original token and falls back for unknown or mismatched presets', () => {
  for (const mode of ['dark', 'light'] as const) {
    expect(getPresetPalette(mode)).toBe(themes[mode]);
    expect(getPresetPalette(mode, 'missing')).toBe(themes[mode]);
    expect(getPresetPalette(mode, mode === 'dark' ? 'alucard' : 'dracula')).toBe(themes[mode]);
  }
  expect(new Set(themePresets.map(preset => preset.id)).size).toBe(11);
  expect(resolveThemePreset('dark', 'alucard').id).toBe('default-dark');
});

it('offers a near-black palette with darker surfaces and readable secondary text', () => {
  const palette = getPresetPalette('dark', 'deep-black');
  expect(palette.canvas).toBe('#1C1C1C');
  expect(palette.xtermBg).toBe('#111111');
  const brightness = (hex: string) => [1, 3, 5].reduce((sum, index) => sum + parseInt(hex.slice(index, index + 2), 16), 0);
  for (const role of ['canvas', 'sidebarBg', 'cardBg', 'fieldBg', 'codeBg', 'xtermBg'] as const) {
    expect(brightness(palette[role])).toBeLessThan(brightness(themes.dark[role]));
    const channels = [1, 3, 5].map(index => parseInt(palette[role].slice(index, index + 2), 16));
    expect(new Set(channels).size).toBe(1);
  }
  expect(contrast(palette.textMuted, palette.fieldBg)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(palette.textSecondary, palette.cardBg)).toBeGreaterThanOrEqual(7);
});

it('maps each scheme across application, editor and terminal with readable controls', () => {
  for (const preset of themePresets.filter(item => item.seed)) {
    const palette = getPresetPalette(preset.mode, preset.id);
    expect(palette.xtermBg).toBe(preset.seed!.terminalBackground ?? preset.seed!.background);
    expect(palette.canvas).toBe(preset.seed!.background);
    expect(palette.codeBg).toBe(palette.canvas);
    expect(contrast(palette.textPrimary, palette.canvas)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(palette.accentText, palette.primaryAction)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(palette.primaryActionText, palette.primaryAction)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(palette.primaryActionText, palette.primaryActionHover)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(palette.dangerActionText, palette.dangerAction)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(palette.segmentedText, palette.segmentedThumb)).toBeGreaterThanOrEqual(4.5);
    const divider = palette.resizeDivider.match(/[\d.]+/g)!.map(Number);
    const background = [1, 3, 5].map(index => parseInt(palette.canvas.slice(index, index + 2), 16));
    const painted = '#' + background.map((value, index) => Math.round(value * (1 - divider[3]) + divider[index] * divider[3]).toString(16).padStart(2, '0')).join('');
    expect(contrast(painted, palette.canvas)).toBeLessThan(1.2);
    expect(Object.keys(paletteToCssVars(palette))).toEqual(Object.keys(paletteToCssVars(themes[preset.mode])));
  }
});

it('remembers independent mode choices and retains custom overrides when switching and restoring', () => {
  cacheThemePresets({ darkPreset: 'dracula', lightPreset: 'catppuccin-latte' });
  setThemeOverrides({ '--canvas': '#123456' });
  applyTheme('dark');
  expect(document.documentElement.dataset.themePreset).toBe('dracula');
  expect(document.documentElement.style.getPropertyValue('--canvas')).toBe('#123456');
  expect(document.documentElement.style.getPropertyValue('--xterm-bg')).toBe('#282A36');
  applyTheme('light');
  expect(document.documentElement.dataset.themePreset).toBe('catppuccin-latte');
  expect(document.documentElement.style.getPropertyValue('--xterm-bg')).toBe('#EFF1F5');
  cacheThemePresets({}); setThemeOverrides({}); applyTheme('dark');
  expect(document.documentElement.style.getPropertyValue('--canvas')).toBe(themes.dark.canvas);
});

it('gives bright schemes independent surface separation and readable colored terminal text', () => {
  for (const preset of themePresets.filter(item => item.mode === 'light' && item.seed)) {
    const palette = getPresetPalette('light', preset.id);
    expect(contrast(palette.canvas, palette.cardBg)).toBeGreaterThanOrEqual(1.12);
    expect(contrast(palette.textPrimary, palette.canvas)).toBeGreaterThanOrEqual(7);
    for (const color of [palette.textSecondary, palette.textMuted, palette.cmdProgram, palette.cmdPath, palette.cmdString]) {
      expect(contrast(color, palette.hover)).toBeGreaterThanOrEqual(4.5);
    }
    for (const color of [palette.xtermBlack, palette.xtermRed, palette.xtermGreen, palette.xtermYellow,
      palette.xtermBlue, palette.xtermMagenta, palette.xtermCyan, palette.xtermWhite]) {
      expect(contrast(color, palette.xtermBg)).toBeGreaterThanOrEqual(4.5);
    }
  }
});

it('handles malformed startup cache without preventing application startup', () => {
  for (const cached of ['null', 'broken', '{"darkPreset":42}', '["dracula"]']) {
    localStorage.setItem('vrykell-theme-presets', cached);
    applyTheme('dark');
    expect(document.documentElement.dataset.themePreset).toBe('default-dark');
  }
});
