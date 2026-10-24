import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import SshFormModal from '../components/SshFormModal';
import { useSshStore } from '../stores/store';
import { useHostLibrary } from '../stores/hostLibrary';
import { groupHosts, tagColor } from '../model/hostTags';
import { validateSshConnection, type SshConnection } from '../services/api';

vi.mock('../services/proxies', () => ({ getProxies: vi.fn().mockResolvedValue({ profiles: [], defaultId: null }) }));
const original = useSshStore.getState();
const save = vi.fn().mockResolvedValue(undefined);
beforeEach(() => {
  save.mockClear(); useSshStore.setState({ save });
  useHostLibrary.setState({ hosts: { existing: { group: 'Production', tags: ['production', 'api'], starred: false } } });
});
afterEach(() => { cleanup(); useSshStore.setState(original, true); useHostLibrary.setState({ hosts: {} }); });

it('edits a complete host in the workspace page and applies a default port', async () => {
  const close = vi.fn();
  render(<SshFormModal page open initial={null} onClose={close} />);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByRole('tablist')).toBeNull();
  fireEvent.change(screen.getByTestId('ssh-form-host'), { target: { value: 'api.test' } });
  fireEvent.change(screen.getByTestId('ssh-form-user'), { target: { value: 'deploy' } });
  fireEvent.click(screen.getByRole('combobox', { name: '已有分组' }));
  fireEvent.click(screen.getByRole('option', { name: 'Production' }));
  fireEvent.click(screen.getByRole('button', { name: '已有标签' }));
  fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'production' }));
  fireEvent.keyDown(window, { key: 'Escape' });
  fireEvent.click(screen.getByTestId('ssh-env-add'));
  fireEvent.change(screen.getByTestId('ssh-env-name-0'), { target: { value: 'LANG' } });
  fireEvent.change(screen.getByTestId('ssh-env-value-0'), { target: { value: 'en_US.UTF-8' } });
  fireEvent.change(screen.getByTestId('ssh-form-notes'), { target: { value: 'Inventory' } });
  fireEvent.change(screen.getByTestId('ssh-form-ai-notes'), { target: { value: 'Avoid restarting services.' } });
  fireEvent.click(screen.getByRole('button', { name: '收藏主机' }));
  expect(screen.getByRole('button', { name: '取消收藏主机' }).querySelector('svg')).toHaveStyle({ color: 'var(--favorite-color)' });
  expect(screen.getByRole('button', { name: '取消收藏主机' })).toHaveClass('ssh-editor-favorite');
  fireEvent.click(screen.getByTestId('ssh-save-btn'));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  const connection = save.mock.calls[0][0] as SshConnection;
  expect(connection).toMatchObject({ name: 'deploy@api.test', port: 22, environment: { LANG: 'en_US.UTF-8' }, notes: 'Inventory', aiNotes: 'Avoid restarting services.' });
  expect(useHostLibrary.getState().hosts[connection.id]).toEqual({ group: 'Production', tags: ['production'], starred: true });
});

it('validates environment names and byte limits without discarding the draft', async () => {
  render(<SshFormModal page open initial={null} onClose={vi.fn()} />);
  fireEvent.change(screen.getByTestId('ssh-form-host'), { target: { value: 'api.test' } });
  fireEvent.change(screen.getByTestId('ssh-form-ai-notes'), { target: { value: '中'.repeat(6000) } });
  fireEvent.click(screen.getByTestId('ssh-save-btn'));
  expect(screen.getByTestId('ssh-test-result')).toHaveTextContent('16,384');
  expect(save).not.toHaveBeenCalled();
  expect(validateSshConnection({ name: 'n', host: 'h', environment: { 'BAD-NAME': 'value' } })).not.toBeNull();
  expect(validateSshConnection({ name: 'n', host: 'h', environment: { LANG: 'value\nBAD=1' } })).not.toBeNull();
  await waitFor(() => expect(screen.getByTestId('ssh-form-host')).toHaveValue('api.test'));
});

it('keeps tag identity stable and groups multi-tag hosts without duplicating untagged ones', () => {
  const hosts: SshConnection[] = [{ id: 'existing', name: 'API', host: 'h', user: '', authMethod: 'key' }, { id: 'other', name: 'Other', host: 'other', user: '', authMethod: 'key' }];
  const groups = groupHosts(hosts, useHostLibrary.getState().hosts, 'tags');
  expect(groups.map(group => [group.name, group.hosts.length])).toEqual([['api', 1], ['production', 1], ['', 1]]);
  expect(tagColor('production')).toBe(tagColor('production'));
  expect(tagColor('api')).toMatch(/^var\(--group-/);
});
