/**
 * blockTypes — 256 色调色板和 CSS 颜色工具。
 */

// ── 256 色调色板 ──

// 使用 CSS 变量而不是写死颜色，保证已完成的命令块与实时 xterm 共用主题。
const ANSI_16 = [
  'var(--xterm-black, #1B1F24)', 'var(--xterm-red, #F28B82)',
  'var(--xterm-green, #A8D5A2)', 'var(--xterm-yellow, #E6C98A)',
  'var(--xterm-blue, #8DB7E8)', 'var(--xterm-magenta, #C5A4D8)',
  'var(--xterm-cyan, #8FCFD0)', 'var(--xterm-white, #D6D9E0)',
  'var(--xterm-bright-black, #66707C)', 'var(--xterm-bright-red, #FF9A92)',
  'var(--xterm-bright-green, #BFE8B7)', 'var(--xterm-bright-yellow, #F2DFA3)',
  'var(--xterm-bright-blue, #A9CCF5)', 'var(--xterm-bright-magenta, #D7B7E8)',
  'var(--xterm-bright-cyan, #B0E4E1)', 'var(--xterm-bright-white, #F3F5F8)',
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
  if (index === 256) return 'var(--xterm-foreground, #D6D9E0)';
  if (index === 257) return 'var(--xterm-bg, #111417)';
  if (index === 258) return 'var(--xterm-cursor, #C9D1DB)';
  if (index >= 259 && index <= 266) return PALETTE[index - 259]!;
  if (index === 267 || index === 268) return 'var(--xterm-foreground, #D6D9E0)';
  return 'var(--xterm-bright-white, #F3F5F8)';
}
