import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import HistoryTerminalIcon from '../components/HistoryTerminalIcon';
import { useHostSystems } from '@config/hostSystems';
import type { BackendSessionEntry } from '@platform/api/types';

afterEach(() => { cleanup(); useHostSystems.setState({ systems: {} }); });

const session = (kind: string, payload: string): BackendSessionEntry => ({ id: 'history', title: '', kind, payload,
  status: 'historical', created_at: 1, closed_at: 2, block_count: 0, cwd: '', sort_order: 0, group_id: null });

it('uses the saved shell from the current pane layout', () => {
  const payload = JSON.stringify({ layout: { type: 'leaf', terminal: { id: 'pane', kind: 'local', shellType: 'powershell' } } });
  const { container } = render(<HistoryTerminalIcon session={session('local', payload)} />);
  expect(container.querySelector('svg')).toHaveAttribute('data-shell-mark', 'powershell');
});

it('uses the shared remote identity for a current SSH pane', () => {
  const payload = JSON.stringify({ layout: { type: 'leaf', terminal: { id: 'pane', kind: 'ssh', ssh: { host: 'host.test' } } } });
  const { container } = render(<HistoryTerminalIcon session={session('ssh', payload)} />);
  expect(container.querySelector('svg')).toHaveAttribute('data-shell-mark', 'linux');
});

it('uses observed host identity from a saved pane connection', () => {
  useHostSystems.getState().remember('remote', 'Debian');
  const payload = JSON.stringify({ layout: { type: 'leaf', terminal: { kind: 'ssh', ssh: { connectionId: 'remote', host: 'host.test' } } } });
  const { container } = render(<HistoryTerminalIcon session={session('ssh', payload)} />);
  expect(container.querySelector('svg')).toHaveAttribute('data-shell-mark', 'debian');
});
