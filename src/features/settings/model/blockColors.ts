/**
 * Named accents offered for block backgrounds and rails.
 *
 * Cool, neutral and warm preset groups reuse the central theme palette.
 * Explicit color choices remain stored as fixed values; names are catalog keys.
 */
import { themes } from '@config/theme/tokens';
export type BlockColorGroup = 'ai' | 'command' | 'failed';

export interface BlockColorPreset {
  name: string;
  value: string;
}

export const BLOCK_COLOR_PRESETS: Record<BlockColorGroup, readonly BlockColorPreset[]> = {
  ai: [
    { name: 'Blue', value: themes.dark.groupBlue },
    { name: 'Sky', value: themes.dark.cmdFlag },
    { name: 'Teal', value: themes.dark.groupCyan },
    { name: 'Indigo', value: themes.dark.groupViolet },
  ],
  command: [
    { name: 'Gray', value: themes.dark.textMuted },
    { name: 'Green', value: themes.dark.groupGreen },
    { name: 'Sand', value: themes.dark.groupAmber },
    { name: 'Slate', value: themes.dark.textSecondary },
  ],
  failed: [
    { name: 'Red', value: themes.dark.groupCoral },
    { name: 'Orange', value: themes.dark.groupOrange },
    { name: 'Rose', value: themes.dark.groupRose },
    { name: 'Amber', value: themes.dark.groupAmber },
  ],
};

/** Alpha of the background tint derived from a picked colour (rail keeps full strength). */
const BLOCK_BACKGROUND_MIX = 22;

/**
 * Background value for a picked colour: the same hue at low alpha, so the rail
 * reads as the accent and the block keeps the tint behind its content — the
 * relationship the failure block already uses.
 */
export function blockBackgroundValue(color: string): string {
  return `color-mix(in srgb, ${color} ${BLOCK_BACKGROUND_MIX}%, transparent)`;
}

/** The preset of one block type matching a stored colour, or null for a custom value. */
export function blockColorPreset(group: BlockColorGroup, value: string): BlockColorPreset | null {
  const normalized = value.trim().toLowerCase();
  return BLOCK_COLOR_PRESETS[group].find(preset => preset.value.toLowerCase() === normalized) ?? null;
}

/**
 * Options for a block's colour dropdown: its own presets, followed by the
 * stored colour when it is not one of them, so a hand-edited theme still shows
 * its actual value. `key` is the i18n key of the preset name, or null when the
 * value came from a custom theme.
 */
export function blockColorOptions(group: BlockColorGroup, value: string): { key: string | null; value: string }[] {
  const presets = BLOCK_COLOR_PRESETS[group].map(preset => ({ key: preset.name, value: preset.value }));
  return blockColorPreset(group, value) ? presets : [...presets, { key: null, value }];
}
