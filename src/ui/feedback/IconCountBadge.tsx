import type { ReactNode } from 'react';
import './IconCountBadge.css';

export default function IconCountBadge({ count, children }: { count: number; children: ReactNode }) {
  if (!Number.isInteger(count) || count < 2) return children;
  return <span className="icon-count-badge" data-icon-count={count} aria-hidden="true">{children}<span className="icon-count-badge-dot">{count}</span></span>;
}
