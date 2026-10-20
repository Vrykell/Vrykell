import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useCommandHistorySettings } from '@config/commandHistory';
import { beforeEach, expect, it, vi } from 'vitest';
import { t } from '@i18n';
import PanelCommandHistory from '../components/PanelCommandHistory';
import { listCommandHistory, getHistoryPreferences, saveHistoryPreferences, mutateHistoryCommand } from '@platform/api/commandHistory';
import { fillHistoryCommand, runHistoryCommand, hasCommandDraft } from '../services/execution';
import { commandKey, emptyPreferences } from '../model/commands';
import { COMMAND_COLLAPSE_KEY } from '../model/collapse';
import type { HistoryCommandPreferences } from '@core/commandHistory';

vi.mock('../hooks/useProjectScope', () => ({ useProjectScope: () => ({ context: { target: 'local', root: '/app', cwd: '/app', scope: 'scope', paneId: 'pane', spec: { id: 'pane', kind: 'local', shellType: 'bash' } },
  visible: true, available: true, cwd: '/app', error: '', chooseRoot: vi.fn(), retry: vi.fn() }) }));
vi.mock('@platform/api/commandHistory', () => ({ listCommandHistory: vi.fn(), getHistoryPreferences: vi.fn(), saveHistoryPreferences: vi.fn(), mutateHistoryCommand: vi.fn() }));
vi.mock('../services/execution', () => ({ fillHistoryCommand: vi.fn(), runHistoryCommand: vi.fn().mockResolvedValue(undefined), hasCommandDraft: vi.fn(() => false) }));
vi.mock('../services/libraryActions', () => ({ importLegacyCommands: vi.fn().mockResolvedValue([]), copyCommand: vi.fn(), openCommandSettings: vi.fn() }));
vi.mock('./../components/CommandComposer', () => ({ default: () => <div /> }));
let saved: HistoryCommandPreferences;
beforeEach(() => {
  useCommandHistorySettings.setState({ runIn: 'new', doubleClick: 'insert', migrated: true });
  localStorage.removeItem('command-history-detail-collapsed');
  localStorage.removeItem('command-history-sort');
  localStorage.removeItem(COMMAND_COLLAPSE_KEY);
  vi.clearAllMocks(); saved = emptyPreferences();
  vi.mocked(getHistoryPreferences).mockImplementation(async () => saved);
  vi.mocked(saveHistoryPreferences).mockImplementation(async (_scope, value) => { saved = value; });
  vi.mocked(mutateHistoryCommand).mockImplementation(async change => { saved = change.preferences; return saved; });
  vi.mocked(hasCommandDraft).mockReturnValue(false);
  vi.mocked(listCommandHistory).mockResolvedValue([
    { id: 'build', target: 'local', shell: 'bash', command: 'npm run build', cwd: '/app', status: 'success', exitCode: 0, timestamp: 1, runCount: 2 },
    { id: 'test', target: 'local', shell: 'bash', command: 'cargo test', cwd: '/app/src-tauri', status: 'failed', exitCode: 1, timestamp: 2, runCount: 1 },
  ]);
});
async function menu(id: string) { fireEvent.click(within(await screen.findByTestId(`command-history-${id}`)).getByRole('button', { name: t('Command actions') })); }

it('keeps custom group colors directly below its menu actions', async () => {
  saved.groups = [{ id: 'tools', name: 'Tools', commandKeys: [] }];
  render(<PanelCommandHistory />);
  await screen.findByTestId('command-history-build');
  fireEvent.click(within(screen.getByTestId('command-group-tools')).getByRole('button', { name: t('Group actions') }));
  const menu = screen.getByRole('menu', { name: t('Group actions') });
  expect(within(menu).queryByRole('menuitem', { name: t('Group color') })).toBeNull();
  expect(within(menu).getByRole('group', { name: t('Group color') })).toBeVisible();
  fireEvent.click(within(menu).getByRole('menuitemradio', { name: t('Blue') }));
  await waitFor(() => expect(saved.groupColors?.tools).toBe('blue'));
  expect(screen.queryByRole('menu')).toBeNull();
});

it('collapses the fixed ungrouped section and offers sorting without custom group management', async () => {
  saved.groups = [{ id: 'build-tools', name: 'Build tools', commandKeys: [] }];
  saved.groupOrder = ['history', 'build-tools', 'favorites'];
  render(<PanelCommandHistory />);
  const row = await screen.findByTestId('command-history-build');
  const section = screen.getByTestId('command-group-history');
  expect(section).toBe(section.parentElement!.lastElementChild);
  expect(section.querySelector('[data-reorder-item="history"]')).toBeNull();
  fireEvent.click(within(section).getByRole('button', { name: t('Ungrouped commands') }));
  expect(row).not.toBeVisible();
  fireEvent.click(within(section).getByRole('button', { name: t('Ungrouped commands') }));
  expect(row).toBeVisible();
  fireEvent.click(within(section).getByRole('button', { name: t('Group actions') }));
  expect(screen.getByRole('menuitem', { name: t('Sort commands') })).toHaveAttribute('aria-haspopup', 'menu');
  expect(screen.queryByText(t('Rename group…'))).toBeNull();
  expect(screen.queryByText(t('Delete command group'))).toBeNull();
  expect(screen.queryByRole('menuitem', { name: t('Group color') })).toBeNull();
});

it('creates an unexecuted history entry before moving a favorite with no recorded runs into history', async () => {
  saved.favorites = [{ id: 'draft', name: 'Preview', command: 'npm run preview', cwd: '/app', shell: 'bash' }];
  render(<PanelCommandHistory />);
  const row = await screen.findByTestId('command-history-draft');
  const original = document.elementFromPoint;
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => screen.getByTestId('command-group-history') });
  fireEvent.pointerDown(row, { pointerId: 1, button: 0, isPrimary: true, clientX: 5, clientY: 5 });
  fireEvent.pointerMove(window, { pointerId: 1, clientX: 20, clientY: 30 });
  fireEvent.pointerUp(window, { pointerId: 1, clientX: 20, clientY: 30 });
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: original });
  await waitFor(() => expect(mutateHistoryCommand).toHaveBeenCalledWith(expect.objectContaining({ original: null, draft: expect.objectContaining({ command: 'npm run preview' }) })));
  await waitFor(() => expect(saved.favorites).toEqual([]));
  expect(saved.historyOrder).toContain(commandKey({ shell: 'bash', cwd: '/app', command: 'npm run preview' }));
  expect(runHistoryCommand).not.toHaveBeenCalled();
});

it('previews on click and inserts only with an explicit action; existing drafts require confirmation', async () => {
  render(<PanelCommandHistory />);
  fireEvent.click(await screen.findByTestId('command-history-build'));
  expect(fillHistoryCommand).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: t('Insert command') }));
  expect(fillHistoryCommand).toHaveBeenCalledWith(expect.objectContaining({ paneId: 'pane' }), expect.objectContaining({ command: 'npm run build' }));
  expect(runHistoryCommand).not.toHaveBeenCalled();
  vi.mocked(hasCommandDraft).mockReturnValue(true);
  fireEvent.doubleClick(screen.getByTestId('command-history-test'));
  expect(screen.getByRole('dialog', { name: t('Replace terminal draft?') })).toBeVisible();
  fireEvent.click(screen.getByTestId('confirm-ok'));
  expect(fillHistoryCommand).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ command: 'cargo test' }));
});

it('executes on double-click only when the application setting requests it', async () => {
  useCommandHistorySettings.getState().update({ runIn: 'current', doubleClick: 'run' });
  render(<PanelCommandHistory />);
  fireEvent.doubleClick(await screen.findByTestId('command-history-build'));
  expect(runHistoryCommand).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ command: 'npm run build' }), 'current');
  expect(fillHistoryCommand).not.toHaveBeenCalled();
});
it('persists favorites and hidden commands and restores a hidden entry', async () => {
  render(<PanelCommandHistory />);
  await menu('build'); fireEvent.click(screen.getByRole('button', { name: t('Save as favorite') }));
  await waitFor(() => expect(saved.favorites).toHaveLength(1));
  await menu('test'); fireEvent.click(screen.getByRole('button', { name: t('Hide this command') }));
  await waitFor(() => expect(screen.queryByTestId('command-history-test')).toBeNull());
  expect(saved.hidden).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: t('Command history actions') }));
  fireEvent.click(screen.getByRole('button', { name: t('Hidden commands and exclusion rules') }));
  fireEvent.click(screen.getByRole('button', { name: t('Restore') }));
  expect(await screen.findByTestId('command-history-test')).toBeVisible();
});
it('refreshes preferences and history from the actions menu and the list background', async () => {
  const { container } = render(<PanelCommandHistory />);
  await screen.findByTestId('command-history-build');
  expect(getHistoryPreferences).toHaveBeenCalledTimes(1);
  expect(listCommandHistory).toHaveBeenCalledTimes(1);

  // A run recorded elsewhere reaches the panel through the menu refresh
  vi.mocked(listCommandHistory).mockResolvedValue([
    { id: 'deploy', target: 'local', shell: 'bash', command: 'npm run deploy', cwd: '/app', status: 'success', exitCode: 0, timestamp: 3, runCount: 1 },
  ]);
  fireEvent.click(screen.getByTestId('command-history-more'));
  fireEvent.click(screen.getByRole('button', { name: t('Refresh') }));
  expect(await screen.findByTestId('command-history-deploy')).toBeVisible();
  await waitFor(() => expect(getHistoryPreferences).toHaveBeenCalledTimes(2));
  expect(listCommandHistory).toHaveBeenCalledTimes(2);

  // The blank area under the list opens the same panel menu
  vi.mocked(listCommandHistory).mockResolvedValue([]);
  fireEvent.contextMenu(container.querySelector('.command-history-body')!);
  fireEvent.click(screen.getByRole('button', { name: t('Refresh') }));
  await waitFor(() => expect(screen.queryByTestId('command-history-deploy')).toBeNull());
  expect(listCommandHistory).toHaveBeenCalledTimes(3);
});

it('filters by name and status and lets users select the execution terminal', async () => {
  render(<PanelCommandHistory />);
  const row = await screen.findByTestId('command-history-build');
  fireEvent.change(screen.getByRole('textbox', { name: t('Search command history') }), { target: { value: 'cargo' } });
  expect(row).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox', { name: t('Search command history') }), { target: { value: '' } });
  act(() => useCommandHistorySettings.getState().update({ runIn: 'current' }));
  fireEvent.click(screen.getByTestId('command-history-build'));
  fireEvent.click(screen.getByRole('button', { name: t('Run command') }));
  expect(runHistoryCommand).toHaveBeenCalledWith(expect.objectContaining({ target: 'local' }), expect.objectContaining({ command: 'npm run build' }), 'current');
});

it('reveals one command detail region at a time without filling or executing', async () => {
  render(<PanelCommandHistory />);
  const build = await screen.findByTestId('command-history-build');
  fireEvent.click(build);
  expect(within(screen.getByRole('region', { name: t('Command details') })).getByText('/app')).toBeVisible();
  expect(build).toHaveAttribute('aria-current', 'true');
  expect(screen.getByRole('region', { name: t('Command details') }).closest('.command-history-body')).toBeNull();
  const test = screen.getByTestId('command-history-test');
  fireEvent.keyDown(test, { key: 'ArrowRight' });
  expect(screen.getAllByRole('region', { name: t('Command details') })).toHaveLength(1);
  expect(within(screen.getByRole('region', { name: t('Command details') })).getByText('/app/src-tauri')).toBeVisible();
  fireEvent.keyDown(test, { key: 'ArrowLeft' });
  expect(screen.queryByRole('region', { name: t('Command details') })).toBeNull();
  expect(fillHistoryCommand).not.toHaveBeenCalled();
  expect(runHistoryCommand).not.toHaveBeenCalled();
});

it('keeps collapsed favorites out of keyboard navigation and expands them for search', async () => {
  saved.favorites = [{ id: 'favorite-build', command: 'npm run build', cwd: '/app', shell: 'bash', name: 'Production build' }];
  render(<PanelCommandHistory />);
  const favorite = await screen.findByTestId('command-history-favorite-build');
  fireEvent.click(screen.getByRole('button', { name: t('Collapse favorites') }));
  expect(favorite).not.toBeVisible();
  const search = screen.getByRole('textbox', { name: t('Search command history') });
  fireEvent.keyDown(search, { key: 'ArrowDown' });
  expect(screen.getByTestId('command-history-test')).toHaveFocus();
  fireEvent.change(search, { target: { value: 'Production' } });
  expect(favorite).toBeVisible();
});

it('remembers folded sections and groups for the next panel load', async () => {
  saved.favorites = [{ id: 'favorite-build', command: 'npm run build', cwd: '/app', shell: 'bash', name: 'Production build' }];
  saved.groups = [{ id: 'release', name: 'Release', commandKeys: [commandKey({ shell: 'bash', cwd: '/app/src-tauri', command: 'cargo test' })] }];
  const first = render(<PanelCommandHistory />);
  await screen.findByTestId('command-history-favorite-build');
  fireEvent.click(screen.getByRole('button', { name: t('Collapse favorites') }));
  fireEvent.click(within(screen.getByTestId('command-group-release')).getByRole('button', { name: 'Release' }));
  expect(screen.getByTestId('command-history-favorite-build')).not.toBeVisible();
  expect(screen.getByTestId('command-history-test')).not.toBeVisible();
  expect(new Set(JSON.parse(localStorage.getItem(COMMAND_COLLAPSE_KEY)!))).toEqual(new Set(['favorites', 'release']));
  first.unmount();
  render(<PanelCommandHistory />);
  await screen.findByTestId('command-history-favorite-build');
  expect(screen.getByRole('button', { name: t('Expand favorites') })).toBeVisible();
  expect(screen.getByTestId('command-history-favorite-build')).not.toBeVisible();
  expect(screen.getByTestId('command-history-test')).not.toBeVisible();
});

it('reveals folded sections during search and returns to the saved layout afterwards', async () => {
  saved.groups = [{ id: 'release', name: 'Release', commandKeys: [commandKey({ shell: 'bash', cwd: '/app', command: 'npm run build' })] }];
  render(<PanelCommandHistory />);
  const row = await screen.findByTestId('command-history-build');
  const title = () => within(screen.getByTestId('command-group-release')).getByRole('button', { name: 'Release' });
  fireEvent.click(title());
  expect(row).not.toBeVisible();
  const search = screen.getByRole('textbox', { name: t('Search command history') });
  fireEvent.change(search, { target: { value: 'npm' } });
  expect(row).toBeVisible();
  fireEvent.change(search, { target: { value: '' } });
  expect(row).not.toBeVisible();
  fireEvent.change(search, { target: { value: 'npm' } });
  expect(row).toBeVisible();
  fireEvent.click(title());
  expect(row).not.toBeVisible();
  fireEvent.change(search, { target: { value: 'npm run' } });
  expect(row).not.toBeVisible();
  fireEvent.change(search, { target: { value: '' } });
  expect(row).not.toBeVisible();
});

it('stores the whole layout from the expand and collapse all actions', async () => {
  saved.groups = [{ id: 'release', name: 'Release', commandKeys: [] }];
  render(<PanelCommandHistory />);
  await screen.findByTestId('command-history-build');
  fireEvent.click(screen.getByRole('button', { name: t('Command history actions') }));
  fireEvent.click(screen.getByRole('button', { name: t('Collapse all command groups') }));
  expect(screen.getByTestId('command-history-build')).not.toBeVisible();
  expect(screen.getByTestId('command-history-test')).not.toBeVisible();
  expect(new Set(JSON.parse(localStorage.getItem(COMMAND_COLLAPSE_KEY)!))).toEqual(new Set(['favorites', 'release', 'history']));
  fireEvent.click(screen.getByRole('button', { name: t('Command history actions') }));
  fireEvent.click(screen.getByRole('button', { name: t('Expand all command groups') }));
  expect(screen.getByTestId('command-history-build')).toBeVisible();
  expect(JSON.parse(localStorage.getItem(COMMAND_COLLAPSE_KEY)!)).toEqual([]);
});

it('remembers frequency sorting and keeps it separate from status and directory filters', async () => {
  render(<PanelCommandHistory />);
  await screen.findByTestId('command-history-build');
  fireEvent.click(within(screen.getByTestId('command-group-history')).getByRole('button', { name: t('Group actions') }));
  fireEvent.click(screen.getByRole('menuitem', { name: t('Sort commands') }));
  fireEvent.click(screen.getByRole('menuitemradio', { name: t('Most used commands') }));
  expect(localStorage.getItem('command-history-sort')).toBe('frequent');
  expect([...screen.getByTestId('command-history-panel').querySelectorAll('[data-command-history]')].map(row => row.getAttribute('data-command-history'))).toEqual(['build', 'test']);
  fireEvent.click(screen.getByRole('button', { name: t('Filter commands') }));
  expect(screen.getByRole('button', { name: t('All statuses') })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: t('Entire project') })).toHaveAttribute('aria-pressed', 'true');
});

it('updates the inspector during keyboard browsing and Enter inserts without execution', async () => {
  render(<PanelCommandHistory />);
  const test = await screen.findByTestId('command-history-test');
  fireEvent.click(test);
  test.focus();
  fireEvent.keyDown(test, { key: 'ArrowDown' });
  const build = screen.getByTestId('command-history-build');
  expect(build).toHaveFocus();
  expect(within(screen.getByRole('region', { name: t('Command details') })).getByText('npm run build')).toBeVisible();
  fireEvent.keyDown(build, { key: 'Enter' });
  expect(fillHistoryCommand).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ command: 'npm run build' }));
  expect(runHistoryCommand).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByRole('button', { name: t('Insert command') }), { key: 'Escape' });
  expect(build).toHaveFocus();
  expect(screen.queryByRole('region', { name: t('Command details') })).toBeNull();
});

it('creates, assigns, colors, renames and deletes a group while retaining its commands', async () => {
  render(<PanelCommandHistory />);
  await screen.findByTestId('command-history-build');
  fireEvent.click(screen.getByRole('button', { name: t('Command history actions') }));
  fireEvent.click(screen.getByRole('button', { name: t('New command group') }));
  const createInput = screen.getByRole('textbox', { name: t('Rename command group') });
  expect(createInput).toHaveValue(t('New group'));
  fireEvent.change(createInput, { target: { value: 'Release' } });
  fireEvent.keyDown(createInput, { key: 'Enter' });
  await waitFor(() => expect(saved.groups?.[0]?.name).toBe('Release'));
  expect(screen.queryByRole('textbox', { name: t('Rename command group') })).toBeNull();
  const groupId = saved.groups![0]!.id;
  const group = screen.getByTestId(`command-group-${groupId}`);
  const row = screen.getByTestId('command-history-build');
  const originalHitTest = document.elementFromPoint;
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => group });
  fireEvent.pointerDown(row, { button: 0, pointerId: 1, isPrimary: true, clientX: 5, clientY: 5 });
  fireEvent.pointerMove(window, { pointerId: 1, clientX: 20, clientY: 30 });
  fireEvent.pointerUp(window, { pointerId: 1, clientX: 20, clientY: 30 });
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: originalHitTest });
  await waitFor(() => expect(saved.groups?.[0]?.commandKeys).toHaveLength(1));
  expect(within(group).getByTestId('command-history-build')).toBeVisible();
  fireEvent.click(within(group).getByRole('button', { name: t('Group color') }));
  fireEvent.click(screen.getByRole('button', { name: t('Blue') }));
  await waitFor(() => expect(saved.groupColors?.[groupId]).toBe('blue'));
  expect(group).toHaveAttribute('data-group-color', 'blue');
  fireEvent.click(within(group).getByRole('button', { name: t('Group actions') }));
  fireEvent.click(screen.getByRole('button', { name: t('Rename group…') }));
  const renameInput = screen.getByRole('textbox', { name: t('Rename command group') });
  expect(renameInput).toHaveValue('Release');
  fireEvent.change(renameInput, { target: { value: 'Deploy' } });
  fireEvent.blur(renameInput);
  expect(screen.queryByRole('textbox', { name: t('Rename command group') })).toBeNull();
  await waitFor(() => expect(saved.groups?.[0]?.name).toBe('Deploy'));
  expect(within(group).getByRole('button', { name: 'Deploy' })).toBeVisible();
  fireEvent.click(within(group).getByRole('button', { name: t('Group actions') }));
  fireEvent.click(screen.getByRole('button', { name: t('Delete command group') }));
  fireEvent.click(screen.getByTestId('confirm-ok'));
  await waitFor(() => expect(saved.groups).toEqual([]));
  expect(screen.queryByTestId(`command-group-${groupId}`)).toBeNull();
  expect(screen.getByTestId('command-history-build')).toBeVisible();
  expect(fillHistoryCommand).not.toHaveBeenCalled();
  expect(runHistoryCommand).not.toHaveBeenCalled();
});

it('opens the command editor focused on the name field from the rename action', async () => {
  render(<PanelCommandHistory />);
  await menu('build');
  fireEvent.click(screen.getByRole('button', { name: t('Rename command') }));
  const dialog = screen.getByRole('dialog', { name: t('Edit command') });
  const name = within(dialog).getByRole('textbox', { name: t('Command name (optional)') });
  await waitFor(() => expect(name).toHaveFocus());
  fireEvent.change(name, { target: { value: 'Release build' } });
  fireEvent.click(within(dialog).getByRole('button', { name: t('Save') }));
  await waitFor(() => expect(mutateHistoryCommand).toHaveBeenCalledWith(expect.objectContaining({
    draft: expect.objectContaining({ name: 'Release build', command: 'npm run build', cwd: '/app', shell: 'bash' }),
  })));
  expect(screen.queryByRole('dialog', { name: t('Edit command') })).toBeNull();
  expect(fillHistoryCommand).not.toHaveBeenCalled();
  expect(runHistoryCommand).not.toHaveBeenCalled();
});

it('shows only starred or grouped commands while retaining status filtering', async () => {
  saved.favorites = [{ id: 'favorite-build', command: 'npm run build', cwd: '/app', shell: 'bash', name: 'Build' }];
  render(<PanelCommandHistory />);
  await screen.findByTestId('command-history-test');
  fireEvent.click(screen.getByRole('button', { name: t('Filter commands') }));
  fireEvent.click(screen.getByRole('button', { name: t('Starred or grouped commands') }));
  expect(screen.getByTestId('command-history-favorite-build')).toBeVisible();
  expect(screen.queryByTestId('command-history-test')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: t('Failed') }));
  expect(screen.queryByTestId('command-history-favorite-build')).toBeNull();
  expect(screen.getByText(t('No matching commands'))).toBeVisible();
});

it('filters to commands recorded in the current shell environment and restores them from the card', async () => {
  saved.favorites = [{ id: 'system-favorite', name: 'System shell list', command: 'dir', cwd: '/app', shell: 'system' }];
  render(<PanelCommandHistory />);
  const favorite = await screen.findByTestId('command-history-system-favorite');
  fireEvent.click(screen.getByRole('button', { name: t('Filter commands') }));
  const filterMenu = screen.getByTestId('command-history-filter-menu');
  expect(within(filterMenu).getByRole('button', { name: t('All environments') })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(within(filterMenu).getByRole('button', { name: t('Same environment only') }));
  expect(favorite).not.toBeInTheDocument();
  expect(screen.getByTestId('command-history-build')).toBeVisible();
  fireEvent.keyDown(document, { key: 'Escape' });
  const card = screen.getByTestId('command-history-filter-environment');
  expect(card).toHaveTextContent(t('Same environment only'));
  fireEvent.click(within(card).getByRole('button', { name: t('Remove filter: {{filter}}', { filter: t('Same environment only') }) }));
  expect(screen.getByTestId('command-history-system-favorite')).toBeVisible();
  expect(screen.queryByTestId('command-history-filter-environment')).toBeNull();
});

it('expands matching custom groups for search and shows independently removable filter cards', async () => {
  saved.groups = [{ id: 'release', name: 'Release', commandKeys: [commandKey({ shell: 'bash', cwd: '/app', command: 'npm run build' })] }];
  render(<PanelCommandHistory />);
  const row = await screen.findByTestId('command-history-build');
  fireEvent.click(within(screen.getByTestId('command-group-release')).getByRole('button', { name: 'Release' }));
  expect(row).not.toBeVisible();
  fireEvent.change(screen.getByRole('textbox', { name: t('Search command history') }), { target: { value: 'npm' } });
  expect(row).toBeVisible();
  fireEvent.change(screen.getByRole('textbox', { name: t('Search command history') }), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: t('Filter commands') }));
  fireEvent.click(screen.getByRole('button', { name: t('Failed') }));
  fireEvent.click(screen.getByRole('button', { name: t('Starred or grouped commands') }));
  fireEvent.click(screen.getByRole('button', { name: t('Current directory') }));
  fireEvent.keyDown(document, { key: 'Escape' });
  const cards = screen.getByTestId('command-history-filter-chips');
  expect(within(cards).getAllByRole('button')).toHaveLength(3);
  expect(cards.closest('.command-history-section')).toBeNull();
  fireEvent.click(within(cards).getByRole('button', { name: t('Remove filter: {{filter}}', { filter: t('Failed') }) }));
  expect(screen.queryByTestId('command-history-filter-status')).toBeNull();
  expect(screen.getByTestId('command-history-filter-collection')).toBeVisible();
  expect(screen.getByTestId('command-history-filter-directory')).toBeVisible();
  expect(screen.queryByRole('button', { name: t('Clear filters') })).toBeNull();
  fireEvent.click(within(cards).getByRole('button', { name: t('Remove filter: {{filter}}', { filter: t('Current directory') }) }));
  fireEvent.click(within(cards).getByRole('button', { name: t('Remove filter: {{filter}}', { filter: t('Starred or grouped commands') }) }));
  expect(screen.queryByTestId('command-history-filter-chips')).toBeNull();
});

it('creates a leading group from an ungrouped command context menu and includes that command', async () => {
  saved.groups = [{ id: 'old', name: 'Old', commandKeys: [] }];
  saved.groupOrder = ['history', 'old', 'favorites'];
  render(<PanelCommandHistory />);
  fireEvent.contextMenu(await screen.findByTestId('command-history-build'));
  fireEvent.click(screen.getByRole('button', { name: t('New command group') }));
  const createInput = screen.getByRole('textbox', { name: t('Rename command group') });
  expect(createInput).toHaveValue(t('New group'));
  fireEvent.change(createInput, { target: { value: 'Build tools' } });
  fireEvent.keyDown(createInput, { key: 'Enter' });
  await waitFor(() => expect(saved.groups?.[0]?.name).toBe('Build tools'));
  const id = saved.groups![0]!.id;
  expect(saved.groups![0]!.commandKeys).toEqual([commandKey({ shell: 'bash', cwd: '/app', command: 'npm run build' })]);
  expect(saved.groupOrder).toEqual([id, 'old', 'favorites', 'history']);
  expect(screen.getByTestId('command-history-build').closest('.command-history-group')).toBe(screen.getByTestId(`command-group-${id}`));
  fireEvent.contextMenu(screen.getByTestId('command-history-build'));
  expect(screen.queryByRole('button', { name: t('New command group') })).toBeNull();
  expect(fillHistoryCommand).not.toHaveBeenCalled();
  expect(runHistoryCommand).not.toHaveBeenCalled();
});
