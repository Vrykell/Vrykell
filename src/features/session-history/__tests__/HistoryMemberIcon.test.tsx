import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import HistoryMemberIcon from '../components/HistoryMemberIcon';
import type { WorkspaceHistoryMember } from '@features/workspace/model/workspaceHistory';

afterEach(cleanup);
it('retains the first member identity rather than replacing it with a generic split symbol', () => {
  const member: WorkspaceHistoryMember = { id: 'terminal:one', reference: 'one', title: 'Shell', kind: 'terminal', local: true, ssh: false, paneCount: 1, shellType: 'powershell' };
  const view = render(<HistoryMemberIcon member={member} />);
  expect(view.container.querySelector('[data-shell-mark="powershell"]')).not.toBeNull();
  view.rerender(<HistoryMemberIcon member={{ ...member, kind: 'conversation' }} />);
  expect(view.container.querySelector('[data-app-mark]')).not.toBeNull();
});
