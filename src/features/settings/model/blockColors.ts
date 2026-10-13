/**
 * Named accents offered for block backgrounds and rails.
 *
 * Each block type owns a disjoint palette — cool for AI, neutral for command
 * output, warm for failures — so the three never read as the same colour.
 * Fixed hex values keep the swatch, the label and the stored theme variable in
 * agreement; `name` doubles as an i18n key.
 */
export type BlockColorGroup = 'ai' | 'command' | 'failed';

export interface BlockColorPreset {
  name: string;
  value: string;
}

export const BLOCK_COLOR_PRESETS: Record<BlockColorGroup, readonly BlockColorPreset[]> = {
  ai: [
    { name: 'Blue', value: '#0A84FF' },
    { name: 'Sky', value: '#4DA3FF' },
    { name: 'Teal', value: '#61DCCB' },
    { name: 'Indigo', value: '#7C7CFF' },
  ],
  command: [
    { name: 'Gray', value: '#8B8F98' },
    { name: 'Green', value: '#6CE6A6' },
    { name: 'Sand', value: '#D6C08C' },
    { name: 'Slate', value: '#6E8899' },
  ],
  failed: [
    { name: 'Red', value: '#F48771' },
    { name: 'Orange', value: '#FFA657' },
    { name: 'Rose', value: '#F07C9A' },
    { name: 'Amber', value: '#E0B33C' },
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
