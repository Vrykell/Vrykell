/**
 * blockTypes — 256 色调色板和 CSS 颜色工具。
 */

// ── 256 色调色板 ──

const ANSI_16 = [
  '#000000',
  '#cc0000',
  '#4e9a06',
  '#c4a000',
  '#3465a4',
  '#75507b',
  '#06989a',
  '#d3d7cf',
  '#555753',
  '#ef2929',
  '#8ae234',
  '#fce94f',
  '#729fcf',
  '#ad7fa8',
  '#34e2e2',
  '#eeeeec',
];

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

/** 调色板索引 → CSS 颜色 */
export function indexToCss(index: number): string {
  if (index >= 0 && index < PALETTE.length) return PALETTE[index]!;
  if (index === 256) return 'var(--fg, #d3d7cf)';
  if (index === 257) return 'var(--bg, #050505)';
  if (index === 258) return 'var(--cursor, #e8e8e8)';
  if (index >= 259 && index <= 266) return PALETTE[index - 259]!;
  if (index === 267 || index === 268) return 'var(--fg, #d3d7cf)';
  return '#ffffff';
}
