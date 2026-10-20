import { describe, expect, it } from 'vitest';
import { BLOCK_COLOR_PRESETS, blockBackgroundValue, blockColorOptions, blockColorPreset } from './blockColors';
import { themes } from '@config/theme/tokens';

describe('blockColors', () => {
  it('resolves a preset of the requested block type regardless of case', () => {
    expect(blockColorPreset('ai', '#409cff')?.name).toBe('Blue');
    expect(blockColorPreset('command', '  #30D158 ')?.name).toBe('Green');
    expect(blockColorPreset('failed', '#ff9f0a')?.name).toBe('Orange');
  });

  it('reports a custom colour as having no preset', () => {
    expect(blockColorPreset('ai', '#123456')).toBeNull();
  });

  it('reuses the shared theme palette without duplicate choices inside a group', () => {
    const palette = themes.dark;
    const shared = new Set([palette.groupBlue, palette.groupGreen, palette.groupViolet, palette.groupAmber,
      palette.groupCyan, palette.groupRose, palette.groupOrange, palette.groupCoral,
      palette.cmdFlag, palette.textMuted, palette.textSecondary]);
    for (const presets of Object.values(BLOCK_COLOR_PRESETS)) {
      expect(new Set(presets.map(preset => preset.value)).size).toBe(presets.length);
      expect(presets.every(preset => shared.has(preset.value))).toBe(true);
    }
  });

  it('derives a tinted background from a picked colour so the rail stays the accent', () => {
    expect(blockBackgroundValue('#61DCCB')).toBe('color-mix(in srgb, #61DCCB 22%, transparent)');
  });

  it('offers the stored colour only when it is not one of the block presets', () => {
    expect(blockColorOptions('ai', '#409CFF')).toHaveLength(BLOCK_COLOR_PRESETS.ai.length);
    const custom = blockColorOptions('ai', '#123456');
    expect(custom).toHaveLength(BLOCK_COLOR_PRESETS.ai.length + 1);
    expect(custom[custom.length - 1]).toEqual({ key: null, value: '#123456' });
    const previous = blockColorOptions('ai', '#0A84FF');
    expect(previous[previous.length - 1]).toEqual({ key: null, value: '#0A84FF' });
  });
});
