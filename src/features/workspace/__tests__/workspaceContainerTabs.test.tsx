import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { t } from '@i18n';
import { tabCapabilities, type TabHandle } from '@ui/layout/tabHandle';
import { useWorkspaceContainerTabs } from '../hooks/useWorkspaceContainerTabs';
import { emptyWorkbench, type WorkspaceContainer } from '../model/workbench';
import { useWorkbenchStore } from '../stores/workbench';
import { useWorkspaceNavigation } from '../stores/navigation';
import { workspaceAreaStores } from '../stores/paneWorkspace';
import { useUiStore } from '../stores/ui';
import * as service from '../services/workbench';
import { requestWorkspaceSplit } from '../services/unifiedWorkspace';
import { useWorkbenchFeedback } from '../stores/workbenchFeedback';

vi.mock('../services/workbench', () => ({ synchronizeWorkbench: vi.fn(), focusNativeContainerResource: vi.fn(), activateContainer: vi.fn(), closeContainer: vi.fn(), renameContainer: vi.fn(), assignWorkspaceGroup: vi.fn(), createContainerGroup: vi.fn(), updateWorkspaceGroup: vi.fn(), removeWorkspaceGroup: vi.fn(), detachWorkspacePane: vi.fn(), removeContainerPane: vi.fn(), persistWorkspaceOrder: vi.fn() }));
vi.mock('../services/unifiedWorkspace', () => ({ requestWorkspaceSplit: vi.fn() }));
const pane = (id: string) => ({ type: 'pane' as const, id, resourceId: `file:${id}` });
const tab = (id: string): WorkspaceContainer => ({ id, scope: 'code', layout: pane(id), focused: id });
const handle = (id: string): TabHandle => ({ id: `file:${id}`, label: id, tip: id, icon: null, closeLabel: 'Close', capabilities: tabCapabilities() });
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };

beforeEach(() => {
  vi.clearAllMocks(); useWorkbenchFeedback.setState({ failure: null });
  useWorkspaceNavigation.setState({ area: 'code', groupColors: {} });
  useWorkbenchStore.setState({ snapshot: { ...emptyWorkbench(), tabs: [tab('one'), tab('two')], selected: { code: 'one' }, groups: [{ id: 'g', scope: 'code', title: 'Group', collapsed: false }] } });
});

it('derives labels, capabilities and group order from real containers and tolerates absent presentation', () => {
  const { result, rerender } = renderHook(({ selected }) => useWorkspaceContainerTabs('code', [handle('one'), { ...handle('system'), surface: 'canvas' }], selected), { initialProps: { selected: 'file:one' } });
  expect(service.focusNativeContainerResource).toHaveBeenCalledWith('file:one');
  expect(result.current.handles.map(item => item.label)).toEqual(['one', t('Start')]);
  expect(result.current.handles[1]!.closeLabel).toBe(t('Close this tab'));
  expect(result.current.tabActions!('one').find(item => item.label === t('Merge tab into this tab'))!.submenu!.items[0]!.label).toBe('');
  expect(result.current.grouping!.order).toContain('tab:file:system');
  act(() => useWorkspaceNavigation.setState({ area: 'ai' })); rerender({ selected: 'file:two' });
  expect(service.focusNativeContainerResource).not.toHaveBeenCalledWith('file:two');
  act(() => result.current.onMove('two', 'one', false));
  expect(useWorkbenchStore.getState().snapshot.tabs[0]!.id).toBe('two');
});

it('offers group archival only when at least one member has session history', () => {
  const one = { ...tab('one'), groupId: 'g' };
  useWorkbenchStore.getState().update(state => ({ ...state, tabs: [one] }));
  const { result } = renderHook(() => useWorkspaceContainerTabs('code', [handle('one')]));
  expect(result.current.grouping!.groups[0]!.archivable).toBe(false);
  for (const kind of ['document', 'terminal', 'conversation', 'agent'] as const) {
    act(() => useWorkbenchStore.getState().update(state => ({ ...state, tabs: [{ ...one, restoreSnapshot: {
      version: 1, focused: one.focused, layout: one.layout!, members: [{ id: 'file:one', title: 'Member', reference: 'one', kind, paneCount: 1, local: true, ssh: false }],
    } }] })));
    expect(result.current.grouping!.groups[0]!.archivable).toBe(kind !== 'document');
  }
});

it('exposes the same split, pane position, merge, detach and remove actions on every container', () => {
  const { result } = renderHook(() => useWorkspaceContainerTabs('code', [handle('one'), handle('two')]));
  expect(result.current.tabActions!('missing')).toEqual([]);
  let actions = result.current.tabActions!('one');
  actions.find(item => item.label === t('Split tab'))!.submenu!.items[0]!.onClick!();
  expect(requestWorkspaceSplit).toHaveBeenCalledWith('file:one', undefined, 'document');
  actions.find(item => item.label === t('Merge tab into this tab'))!.submenu!.items[0]!.onClick!();
  expect(workspaceAreaStores.code.getState().pendingMergeTab).toBe('two');
  act(() => useWorkbenchStore.getState().update(state => ({ ...state, tabs: [{ ...tab('one'), layout: { type: 'split', direction: 'row', ratio: 0.5, first: pane('one'), second: pane('three') }, focused: 'missing' }, { ...tab('two'), title: 'Peer' }, { ...tab('empty'), layout: null }] })));
  actions = result.current.tabActions!('one');
  actions.find(item => item.label === t('Change pane position'))!.onClick!();
  expect(useUiStore.getState().paneMove).toMatchObject({ open: true, containerId: 'one', paneId: 'one' });
  act(() => useUiStore.getState().cancelPaneMove());
  actions.find(item => item.label === t('Move pane to new tab'))!.onClick!();
  actions.find(item => item.label === t('Remove pane'))!.onClick!();
  expect(service.detachWorkspacePane).toHaveBeenCalledWith('code', 'file:one');
  expect(service.removeContainerPane).toHaveBeenCalledWith('one', 'file:one');
  expect(actions.find(item => item.label === t('Merge tab into this tab'))!.submenu!.items[0]!.label).toBe('Peer');
  expect(result.current.tabActions!('empty')).toEqual([]);
  act(() => useWorkbenchStore.getState().update(state => ({ ...state, tabs: [{ ...tab('one'), layout: { type: 'split', direction: 'col', ratio: 0.5, first: { type: 'split', direction: 'row', ratio: 0.5, first: pane('one'), second: pane('two') }, second: { type: 'split', direction: 'row', ratio: 0.5, first: pane('three'), second: pane('four') } } }] })));
  expect(result.current.tabActions!('one').some(item => item.label === t('Split tab'))).toBe(false);
  expect(result.current.tabActions!('one').some(item => item.label === t('Zoom pane'))).toBe(false);
});

it('starts pane repositioning from the focused pane and preserves pane identity', () => {
  const layout = { type: 'split' as const, direction: 'row' as const, ratio: 0.5, first: pane('one'), second: pane('three') };
  useWorkbenchStore.setState(state => ({ ...state, snapshot: { ...state.snapshot, tabs: [{ ...tab('one'), layout, focused: 'three' }], selected: { code: 'one' } } }));
  const { result } = renderHook(() => useWorkspaceContainerTabs('code', [handle('one')]));
  act(() => result.current.tabActions!('one').find(item => item.label === t('Change pane position'))!.onClick!());
  expect(useUiStore.getState().paneMove).toMatchObject({ open: true, containerId: 'one', paneId: 'three' });
  act(() => useUiStore.getState().cancelPaneMove());
  act(() => result.current.tabActions!('one').find(item => item.label === t('Change pane position'))!.onClick!());
  expect(useUiStore.getState().paneMove).toMatchObject({ open: true, containerId: 'one', paneId: 'three' });
});

it('moves utility pages and content through the same persisted strip order', async () => {
  const { result } = renderHook(() => useWorkspaceContainerTabs('code', [handle('one'), handle('two')], undefined, ['history']));
  act(() => result.current.onMove('history', 'one', false));
  expect(result.current.grouping!.order).toEqual(['group:g', 'tab:history', 'tab:one', 'tab:two']);
  act(() => result.current.onMove('one', 'history', false));
  expect(result.current.grouping!.order).toEqual(['group:g', 'tab:one', 'tab:history', 'tab:two']);
  await flush(); expect(service.persistWorkspaceOrder).toHaveBeenCalledWith('code');
});

it('persists group mutations, validates colors and exposes a persistent retry for failures', async () => {
  const { result } = renderHook(() => useWorkspaceContainerTabs('code', []));
  const grouping = result.current.grouping!;
  vi.mocked(service.createContainerGroup).mockResolvedValueOnce('g');
  expect(await grouping.create('one')).toBe('g');
  vi.mocked(service.createContainerGroup).mockRejectedValueOnce(new Error('offline'));
  expect(await grouping.create('two')).toBeUndefined();
  const calls = vi.mocked(service.createContainerGroup).mock.calls;
  const retryGroupId = calls[calls.length - 1]![2];
  expect(useWorkbenchFeedback.getState().failure?.error).toBeInstanceOf(Error);
  useWorkbenchFeedback.getState().failure!.retry!(); await flush();
  expect(service.createContainerGroup).toHaveBeenLastCalledWith('two', undefined, retryGroupId);
  grouping.assign('one', 'g'); grouping.rename('g', 'Renamed'); grouping.collapse('g', true); await flush();
  expect(service.assignWorkspaceGroup).toHaveBeenCalledWith('one', 'g');
  expect(service.updateWorkspaceGroup).toHaveBeenCalledWith('g', { title: 'Renamed' });
  grouping.color('g', 'rose'); grouping.color('g', 'invalid'); expect(useWorkspaceNavigation.getState().groupColors.g).toBe('rose');
  grouping.color('g', null); expect(useWorkspaceNavigation.getState().groupColors.g).toBeUndefined();
  grouping.move('g', 'two', true); await flush(); expect(service.persistWorkspaceOrder).toHaveBeenCalledWith('code');
  grouping.move('g', undefined, false); await flush();
  const ordered = useWorkbenchStore.getState().snapshot.order.code ?? [];
  expect(ordered[ordered.length - 1]).toBe('group:g');
  grouping.move('one', 'g', false); await flush();
  vi.mocked(service.removeWorkspaceGroup).mockImplementationOnce((_id, _mode, onError) => onError(new Error('delete failed')));
  grouping.remove('g', 'delete'); expect(useWorkbenchFeedback.getState().failure?.error).toBeInstanceOf(Error);
  useWorkbenchFeedback.getState().failure!.retry!(); expect(service.removeWorkspaceGroup).toHaveBeenCalledTimes(2);
  vi.mocked(service.assignWorkspaceGroup).mockRejectedValueOnce(new Error('save failed'));
  grouping.assign('two'); await flush(); expect(useWorkbenchFeedback.getState().failure?.error).toBeInstanceOf(Error);
});
