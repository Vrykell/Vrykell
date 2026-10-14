/**
 * usageTable — shared table conventions for the usage page's three tables.
 *
 * Mirrors the reference dashboard: 12px header in the muted colour, 36px rows, a bottom border
 * per row, tabular figures, every column (numbers included) aligned to the same edge, and the
 * table scrolling on its own so the page never overflows sideways.
 */
import type { CSSProperties } from 'react';

export const usageTable = {
  scroller: { width: '100%', overflowX: 'auto' } as CSSProperties,
  table: { width: '100%', borderCollapse: 'collapse', tableLayout: 'auto' } as CSSProperties,
  headRow: { borderBottom: '1px solid var(--border)' } as CSSProperties,
  th: {
    height: 36, padding: '0 6px', textAlign: 'left', whiteSpace: 'nowrap',
    color: 'var(--text-secondary)', fontSize: 'var(--fs-caption)', fontWeight: 'var(--fw-medium)',
  } as CSSProperties,
  row: { height: 36, borderBottom: '1px solid var(--border)' } as CSSProperties,
  td: {
    padding: '0 6px', whiteSpace: 'nowrap', color: 'var(--text-secondary)',
    fontSize: 'var(--fs-caption)', fontVariantNumeric: 'tabular-nums',
  } as CSSProperties,
  mono: { fontFamily: 'var(--font-mono)' } as CSSProperties,
  primary: { color: 'var(--text-primary)' } as CSSProperties,
  muted: { color: 'var(--text-muted)' } as CSSProperties,
  empty: {
    padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--fs-caption)',
  } as CSSProperties,
};
