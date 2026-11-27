import type { CSSProperties, ReactNode } from 'react';

export default function WorkspaceStartPage({
  icon,
  title,
  description,
  actions,
  columns,
  testId,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  actions: ReactNode;
  columns?: number;
  testId?: string;
}) {
  return (
    <div className="workspace-empty workspace-start-page workspace-start-simple" data-testid={testId}>
      <div className="workspace-start-simple-body">
        <span className="workspace-start-simple-icon" aria-hidden="true">
          {icon}
        </span>
        <h2>{title}</h2>
        <p>{description}</p>
        <div
          className="workspace-start-simple-actions"
          data-grid={columns ? 'true' : undefined}
          style={columns ? ({ '--start-actions-columns': columns } as CSSProperties) : undefined}>
          {actions}
        </div>
      </div>
    </div>
  );
}
