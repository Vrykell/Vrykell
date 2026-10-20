/** Indexed terminal colors and CSS theme references. */
import { paletteToCssVars, themes } from '@config/theme/tokens';

const DEFAULT_VARS = paletteToCssVars(themes.dark);
function themeColor(name: string): string {
  return `var(${name}, ${DEFAULT_VARS[name]})`;
}

// Completed blocks and live output share both variables and palette fallbacks.
const ANSI_16 = [
  '--xterm-black', '--xterm-red', '--xterm-green', '--xterm-yellow',
  '--xterm-blue', '--xterm-magenta', '--xterm-cyan', '--xterm-white',
  '--xterm-bright-black', '--xterm-bright-red', '--xterm-bright-green', '--xterm-bright-yellow',
  '--xterm-bright-blue', '--xterm-bright-magenta', '--xterm-bright-cyan', '--xterm-bright-white',
].map(themeColor);

function buildColorCube(): string[] {
  const colors: string[] = [];
  for (const r of [0, 0x5f, 0x87, 0xaf, 0xd7, 0xff]) {
    for (const g of [0, 0x5f, 0x87, 0xaf, 0xd7, 0xff]) {
      for (const b of [0, 0x5f, 0x87, 0xaf, 0xd7, 0xff]) {
        colors.push(
          `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`,
        );
      }
    }
  }
  return colors;
}

function buildGrayscale(): string[] {
  const colors: string[] = [];
  for (let i = 0; i < 24; i++) {
    const v = 8 + i * 10;
    colors.push(
      `#${v.toString(16).padStart(2, '0')}${v.toString(16).padStart(2, '0')}${v.toString(16).padStart(2, '0')}`,
    );
  }
  return colors;
}

export const PALETTE: string[] = [...ANSI_16, ...buildColorCube(), ...buildGrayscale()];

/** Resolve a palette index to its CSS color. */
export function indexToCss(index: number): string {
  if (index >= 0 && index < PALETTE.length) return PALETTE[index]!;
  if (index === 256) return themeColor('--xterm-foreground');
  if (index === 257) return themeColor('--xterm-bg');
  if (index === 258) return themeColor('--xterm-cursor');
  if (index >= 259 && index <= 266) return PALETTE[index - 259]!;
  if (index === 267 || index === 268) return themeColor('--xterm-foreground');
  return themeColor('--xterm-bright-white');
}
