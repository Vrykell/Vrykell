import { afterEach, describe, expect, it } from 'vitest';
import {
  applyTheme,
  getCurrentTheme,
  getThemeOverrides,
  hexToRgba,
  paletteToCssVars,
  setThemeOverrides,
  TEAL_THEME_PRESET,
  themes,
  toRgba,
} from '@/services/theme/tokens';

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

describe('默认调色板（中性，主色不带颜色倾向）', () => {
  it('dark 与 light 均存在', () => {
    expect(themes.dark).toBeDefined();
    expect(themes.light).toBeDefined();
  });

  it('dark 主色为近中性（各通道差 ≤ 16，无显著色相）', () => {
    // 中性：R≈G≈B。允许极轻微冷/暖偏差，但不允许出现明显色相
    // （带色方案只在 TEAL_THEME_PRESET 中提供）。
    const accent = themes.dark.accent;
    expect(accent.startsWith('#')).toBe(true);
    const [r, g, b] = [
      parseInt(accent.slice(1, 3), 16),
      parseInt(accent.slice(3, 5), 16),
      parseInt(accent.slice(5, 7), 16),
    ];
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThanOrEqual(16);
  });

  it('light 主色同样为近中性', () => {
    const accent = themes.light.accent;
    const [r, g, b] = [
      parseInt(accent.slice(1, 3), 16),
      parseInt(accent.slice(3, 5), 16),
      parseInt(accent.slice(5, 7), 16),
    ];
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThanOrEqual(16);
  });

  it('dark 语义色保留（成功/错误/警告）', () => {
    expect(themes.dark.success).toBe('#89D185');
    expect(themes.dark.error).toBe('#F14C4C');
    expect(themes.dark.warning).toBe('#CCA700');
  });
});

describe('paletteToCssVars', () => {
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
      '--canvas',
      '--surface',
      '--block',
      '--elevated',
      '--border',
      '--border-strong',
      '--overlay',
      '--overlay-light',
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
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe(
      TEAL_THEME_PRESET['--accent'],
    );
  });
});

function camelToKebab(s: string): string {
  return s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}
