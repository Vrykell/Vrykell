import type { CSSProperties } from 'react';

/** Layout shared by settings fields; the shared field class owns the themed surface and focus edge. */
export const inputStyle: CSSProperties = {
  width: '100%', fontFamily: 'var(--font-ui)', boxSizing: 'border-box',
};
