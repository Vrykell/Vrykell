import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useSessionStore } from '@features/workspace';
import { useTerminalStore } from '@features/terminal';
import { leaf } from '@features/workspace/model/windowLayout';
import { useSshAuthenticationLifetime } from '../hooks/useSessionAuthentication';
import { finishSshAuthentication, requestSshAuthentication, useSessionAuthenticationStore } from '../stores/sessionAuthentication';

const mocks = vi.hoisted(() => ({ forget: vi.fn() }));
vi.mock('../services/api', () => ({ sshForgetSessionAuth: mocks.forget }));

beforeEach(() => {
  vi.clearAllMocks(); mocks.forget.mockResolvedValue(undefined);
  useSessionAuthenticationStore.setState({ request: null, revisions: {}, temporary: {} });
  const pane = (id: string) => leaf({ id, kind: 'ssh', ssh: { host: 'server.test', name: 'Server', connectionId: 'one' } });
  useSessionStore.setState({ activeId: 'tab', tabs: [{ id: 'tab', kind: 'session', title: 'SSH', layout: {
    type: 'split', dir: 'row', ratio: 0.5, first: pane('first'), second: pane('second'),
  } }] });
  useTerminalStore.setState({ sessions: { first: 'session-one', second: 'session-two' } });
});

it('keeps credentials while another pane uses the connection and forgets them after the last ends', async () => {
  renderHook(useSshAuthenticationLifetime);
  act(() => useTerminalStore.setState({ sessions: { second: 'session-two' } }));
  expect(mocks.forget).not.toHaveBeenCalled();
  act(() => useTerminalStore.setState({ sessions: {} }));
  await waitFor(() => expect(mocks.forget).toHaveBeenCalledWith('one'));
  expect(mocks.forget).toHaveBeenCalledTimes(1);
});

it('publishes only the matching authentication completion and isolates profile revisions', () => {
  requestSshAuthentication({ connectionId: 'one', host: 'server.test' });
  const request = useSessionAuthenticationStore.getState().request!;
  finishSshAuthentication(request.requestId - 1);
  expect(useSessionAuthenticationStore.getState().request).toEqual(request);
  finishSshAuthentication(request.requestId);
  expect(useSessionAuthenticationStore.getState().revisions).toEqual({ one: 1 });
  expect(useSessionAuthenticationStore.getState().temporary).toEqual({ one: true });
});
