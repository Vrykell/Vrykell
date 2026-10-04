import type { CSSProperties } from 'react';

export const inputStyle: CSSProperties = {
  background: 'var(--surface)', border: '1px solid var(--border)',
  borderRadius: 'var(--radius-inner)', padding: '6px 8px', fontSize: 'calc(12px * var(--ui-font-scale))',
  color: 'var(--text-primary)', outline: 'none', width: '100%',
  fontFamily: 'var(--font-mono)', boxSizing: 'border-box',
};

export const btnStyle: CSSProperties = {
  padding: '5px 12px', fontSize: 'calc(12px * var(--ui-font-scale))', border: '1px solid var(--border)',
  borderRadius: 'var(--radius-inner)', background: 'transparent',
  color: 'var(--text-secondary)', cursor: 'pointer',
};
