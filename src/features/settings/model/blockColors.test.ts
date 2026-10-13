import { describe, expect, it } from 'vitest';
import { BLOCK_COLOR_PRESETS, blockBackgroundValue, blockColorOptions, blockColorPreset } from './blockColors';

describe('blockColors', () => {
  it('resolves a preset of the requested block type regardless of case', () => {
    expect(blockColorPreset('ai', '#0a84ff')?.name).toBe('Blue');
    expect(blockColorPreset('command', '  #6CE6A6 ')?.name).toBe('Green');
    expect(blockColorPreset('failed', '#ffa657')?.name).toBe('Orange');
  });

  it('reports a custom colour as having no preset', () => {
    expect(blockColorPreset('ai', '#123456')).toBeNull();
  });

  it('gives the three block types disjoint palettes so they stay distinguishable', () => {
    const groups = Object.values(BLOCK_COLOR_PRESETS);
    const values = groups.flatMap(presets => presets.map(preset => preset.value.toLowerCase()));
    expect(new Set(values).size).toBe(values.length);
    expect(groups.every(presets => presets.length > 0)).toBe(true);
  });

  it('derives a tinted background from a picked colour so the rail stays the accent', () => {
    expect(blockBackgroundValue('#61DCCB')).toBe('color-mix(in srgb, #61DCCB 22%, transparent)');
  });

  it('offers the stored colour only when it is not one of the block presets', () => {
    expect(blockColorOptions('ai', '#0A84FF')).toHaveLength(BLOCK_COLOR_PRESETS.ai.length);
    const custom = blockColorOptions('ai', '#123456');
    expect(custom).toHaveLength(BLOCK_COLOR_PRESETS.ai.length + 1);
    expect(custom[custom.length - 1]).toEqual({ key: null, value: '#123456' });
  });
});
