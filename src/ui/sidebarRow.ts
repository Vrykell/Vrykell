import type { CSSProperties } from 'react';

export const sidebarRowSpacing: CSSProperties = { padding: '2px 6px', cursor: 'pointer' };
export const sidebarRowContent: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '8px 10px', minHeight: 40, borderRadius: 'var(--radius-inner)',
  transition: 'background 0.12s ease',
};
export const sidebarRowIcon: CSSProperties = {
  width: 18, height: 18, flexShrink: 0,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
};
export const sidebarRowTitle: CSSProperties = {
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  fontSize: 'var(--fs-label)', lineHeight: '18px',
};
