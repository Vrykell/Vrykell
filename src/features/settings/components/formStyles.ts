import type { CSSProperties } from 'react';

export const inputStyle: CSSProperties = {
  background: 'var(--field-bg)', border: '1px solid var(--border)',
  borderRadius: 'var(--radius-inner)', padding: '6px 8px', fontSize: 'calc(12px * var(--ui-font-scale))',
  color: 'var(--text-primary)', outline: 'none', width: '100%',
  fontFamily: 'var(--font-mono)', boxSizing: 'border-box',
};
