import type { CSSProperties, ReactNode } from 'react';

/**
 * The start page shared by the terminal, editor, AI and unified workspaces: one centered
 * icon, a title, one line of orientation and the primary actions. Feature-specific lists
 * stay behind those actions instead of competing with them on the resting page.
 *
 * `columns` opts into an even grid so a page with an unround number of actions never ends up
 * with ragged rows of mismatched widths. Without it the actions simply wrap and centre.
 */
export default function WorkspaceStartPage({ icon, title, description, actions, columns, testId, contentTestId, children }: {
  icon: ReactNode;
  title: string;
  description: string;
  actions?: ReactNode;
  columns?: number;
  testId?: string;
  contentTestId?: string;
  children?: ReactNode;
}) {
  return <div className="workspace-empty workspace-start-page workspace-start-simple" data-testid={testId}>
    <div className="workspace-start-simple-body" data-testid={contentTestId}>
      <span className="workspace-start-simple-icon">{icon}</span>
      <h2>{title}</h2>
      <p>{description}</p>
      {actions && <div className="workspace-start-simple-actions" data-grid={columns ? 'true' : undefined}
        style={columns ? { '--start-actions-columns': columns } as CSSProperties : undefined}>{actions}</div>}
      {children}
    </div>
  </div>;
}
