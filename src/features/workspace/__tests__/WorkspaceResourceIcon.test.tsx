import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import WorkspaceResourceIcon from '../components/WorkspaceResourceIcon';
import { useWorkspaceStore } from '../stores/workspace';
import { leaf } from '../model/windowLayout';

afterEach(cleanup);
it('uses the selected terminal pane profile and resolves unspecified local profiles consistently', () => {
  useWorkspaceStore.setState({ tabs: [{ id: 'shell', kind: 'session', title: 'Shell', layout: { type: 'split', dir: 'row', ratio: 0.5,
    first: leaf({ id: 'first', kind: 'local' }), second: leaf({ id: 'second', kind: 'local', shellType: 'bash' }) } }] });
  const resource = { id: 'terminal:first', kind: 'terminal' as const, tabId: 'shell', paneId: 'first', title: 'Shell' };
  const view = render(<WorkspaceResourceIcon resource={resource} defaultShellType="powershell" />);
  expect(view.container.querySelector('[data-shell-mark="powershell"]')).not.toBeNull();
  view.rerender(<WorkspaceResourceIcon resource={{ ...resource, paneId: 'second' }} defaultShellType="powershell" />);
  expect(view.container.querySelector('[data-shell-mark="bash"]')).not.toBeNull();
  expect(view.container.querySelector('[data-shell-mark="cmd"]')).toBeNull();
});
