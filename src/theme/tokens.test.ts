import { describe, it, expect, afterEach } from 'vitest';
import { hexToRgba, toRgba, setThemeOverrides, applyTheme } from './tokens';

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
    expect(document.documentElement.style.getPropertyValue('--surface')).toBe('#0A0A0A');
  });

  it('applies base only when overrides empty', () => {
    setThemeOverrides({});
    applyTheme('dark');
    expect(document.documentElement.style.getPropertyValue('--canvas')).toBe('#0A0A0A');
  });
});
