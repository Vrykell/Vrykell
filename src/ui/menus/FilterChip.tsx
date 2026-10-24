import type { ReactNode } from 'react';
import { X } from '@ui/icons';

/** Removable conditions reuse the workspace search scope card. */
export default function FilterChip({ children, icon, removeLabel, onRemove, testId }: {
  children: ReactNode; icon?: ReactNode; removeLabel: string; onRemove: () => void; testId?: string;
}) {
  return <span className="search-scope-chip" data-testid={testId}>
    {icon}
    <span>{children}</span>
    <button type="button" data-subtle aria-label={removeLabel} data-tip={removeLabel} onClick={onRemove}><X size={12} /></button>
  </span>;
}
