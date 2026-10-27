import { beforeEach, expect, it } from 'vitest';
import { createWorkbenchStore } from '../stores/workbench';
import { createPaneWorkspaceStore } from '../stores/paneWorkspace';
import { emptyWorkbench, putContainer, selectContainer, type WorkspaceContainer } from '../model/workbench';
import { workspacePaneCells, workspacePaneIds, type WorkspacePaneLayout } from '../model/workspaceResources';

const pane = (id: string): Extract<WorkspacePaneLayout, { type: 'pane' }> => ({ type: 'pane', id, resourceId: `file:${id}` });
const tab = (id: string, layout: WorkspacePaneLayout | null = pane(id)): WorkspaceContainer => ({ id, scope: 'code', layout, focused: id, zoomed: null });
const target = (id: string) => ({ leafId: id, dir: 'row' as const, position: 'second' as const, rect: { x: 0, y: 0, w: 1, h: 1 } });
const setup = () => { const workbench = createWorkbenchStore('test-containers'); const area = createPaneWorkspaceStore('code', workbench); return { workbench, area }; };

beforeEach(() => localStorage.clear());

it('persists one versioned snapshot and does not write unchanged state or transient placement controls', () => {
  const { workbench, area } = setup();
  workbench.getState().update(state => state);
  expect(localStorage.getItem('test-containers')).toBeNull();
  area.getState().show('file:a');
  const saved = localStorage.getItem('test-containers');
  expect(JSON.parse(saved!)).toMatchObject({ version: 2, tabs: [{ scope: 'code', layout: { resourceId: 'file:a' } }] });
  area.setState({ choosingSplit: true, splitAnchor: { x: 2, y: 3 } });
  expect(localStorage.getItem('test-containers')).toBe(saved);
  expect(createWorkbenchStore('test-containers').getState().snapshot).toEqual(workbench.getState().snapshot);
  localStorage.setItem('bad', 'broken'); expect(createWorkbenchStore('bad').getState().snapshot.tabs).toEqual([]);
});

it('does not overwrite a saved snapshot while native resources are still hydrating', () => {
  const workbench = createWorkbenchStore('hydrating', false);
  const area = createPaneWorkspaceStore('code', workbench);
  workbench.getState().update(state => putContainer(state, tab('a')));
  area.getState().reconcile([]); expect(workbench.getState().snapshot.tabs).toHaveLength(1);
  expect(localStorage.getItem('hydrating')).toBeNull();
  workbench.setState({ ready: true });
  expect(JSON.parse(localStorage.getItem('hydrating')!)).toMatchObject({ tabs: [{ id: 'a' }] });
});

it('shows the empty fallback once, repairs selection and preserves every independent tab', () => {
  const { workbench, area } = setup();
  area.getState().single(); area.getState().ratio('a', 'b', 0.3); area.getState().removePane('a'); area.getState().merge('missing', target('a')); area.getState().detach('file:a');
  area.getState().openStart(); const initial = area.getState().activeTabId;
  area.getState().openStart(); expect(area.getState().activeTabId).toBe(initial);
  area.getState().ratio('a', 'b', 0.4);
  area.getState().reconcile(['file:a', 'file:b']);
  expect(workbench.getState().snapshot.tabs).toHaveLength(2);
  const ids = workbench.getState().snapshot.tabs.map(tab => tab.id);
  area.getState().selectTab(ids[0]!); area.getState().openStart(); expect(area.getState().activeTabId).toBe(ids[0]);
  area.getState().chooseMerge(ids[1]); expect(area.getState().pendingMergeTab).toBe(ids[1]);
  area.getState().selectTab(ids[1]!); expect(area.getState().pendingMergeTab).toBeUndefined();
  area.getState().selectTab(ids[0]!);
  area.getState().selectTab('missing'); expect(area.getState().activeTabId).toBe(ids[0]);
  workbench.setState({ snapshot: { ...workbench.getState().snapshot, selected: {} } });
  area.getState().openStart(); expect(area.getState().activeTabId).toBe(ids[0]);
  workbench.setState({ snapshot: { ...workbench.getState().snapshot, selected: {} } });
  area.getState().reconcile(['file:a', 'file:b']); expect(area.getState().activeTabId).toBe(ids[0]);
  area.getState().show('file:a'); expect(workbench.getState().snapshot.tabs).toHaveLength(2);
  area.getState().reconcile([]); expect(area.getState().layout).toBeNull();
  area.getState().reconcile([]); expect(workbench.getState().snapshot.tabs).toHaveLength(1);
});

it('retains the placement target when opening a new resource changes native selection', () => {
  const { workbench, area } = setup();
  area.getState().split('file:a', 'row'); const first = area.getState().activeTabId; const firstPane = area.getState().focused;
  area.getState().show('file:b');
  area.getState().place('file:b', target(firstPane));
  expect(area.getState().activeTabId).toBe(first);
  expect(workspacePaneIds(area.getState().layout!)).toEqual(['file:a', 'file:b']);
  expect(workbench.getState().snapshot.tabs).toHaveLength(1);
  area.getState().split('file:c', 'col');
  expect(workspacePaneIds(area.getState().layout!)).toEqual(['file:a', 'file:b', 'file:c']);
  area.getState().place('file:missing', target('stale')); expect(workspacePaneIds(area.getState().layout!)).toHaveLength(3);
  area.getState().single(); expect(area.getState().zoomed).toBe(area.getState().focused);
  area.getState().single(); expect(area.getState().zoomed).toBeNull();
  const cells = workspacePaneCells(area.getState().layout!);
  area.getState().ratio(cells[1]!.id, cells[2]!.id, 10);
  expect(JSON.stringify(area.getState().layout)).toContain('0.8');
  area.getState().ratio(cells[0]!.id, cells[1]!.id, -2);
  expect(JSON.stringify(area.getState().layout)).toContain('0.2');
  area.getState().removePane(cells[2]!.id); expect(workspacePaneIds(area.getState().layout!)).toHaveLength(2);
  area.getState().removePane('missing'); expect(workspacePaneIds(area.getState().layout!)).toHaveLength(2);
  area.getState().removePane(cells[1]!.id); expect(workspacePaneIds(area.getState().layout!)).toEqual(['file:a']);
  area.getState().removePane(cells[0]!.id); expect(area.getState().layout).not.toBeNull();
});

it('moves, detaches and merges complete tabs without resetting the moved pane identity', () => {
  const { workbench, area } = setup();
  area.getState().reconcile(['file:a', 'file:b']);
  const [first, second] = workbench.getState().snapshot.tabs;
  area.getState().move([], second!.id, first!.id, false);
  expect(workbench.getState().snapshot.tabs[0]!.id).toBe(second!.id);
  area.getState().selectTab(first!.id); area.getState().split('file:b', 'row');
  const movedPane = workspacePaneCells(area.getState().layout!)[1]!;
  const detached = area.getState().detach('file:b');
  expect(detached).toBeTruthy(); expect(area.getState().layout).toMatchObject({ id: movedPane.id, resourceId: movedPane.resourceId });
  area.getState().selectTab(first!.id); area.getState().merge(detached!, target(area.getState().focused));
  expect(workspacePaneIds(area.getState().layout!)).toEqual(['file:a', 'file:b']);
  expect(area.getState().detach('missing')).toBeUndefined();
  area.getState().show('file:c'); expect(area.getState().detach('file:c')).toBeUndefined();
});

it('restores by identity or resource set, releases former owners and ignores corrupt layouts', () => {
  const { workbench, area } = setup();
  area.getState().restore({ nonsense: true } as unknown as WorkspacePaneLayout, 'a'); expect(area.getState().layout).toBeNull();
  area.getState().show('file:a'); const original = area.getState().activeTabId;
  area.getState().show('file:b');
  area.getState().restore(pane('a'), 'a'); expect(workbench.getState().snapshot.tabs).toHaveLength(2);
  expect(workbench.getState().snapshot.tabs[0]!.id).toBe(original);
  expect(area.getState().activeTabId).toBe(original);
  const layout: WorkspacePaneLayout = { type: 'split', direction: 'row', ratio: 0.5, first: pane('a'), second: pane('b') };
  const identity = { id: 'workspace:restored', createdAt: 1 };
  area.getState().restore(layout, 'b', identity); expect(workbench.getState().snapshot.tabs).toHaveLength(1);
  const id = area.getState().activeTabId;
  area.getState().restore(layout, 'a', identity); expect(area.getState().activeTabId).toBe(id);
  expect(area.getState().focused).toBe('a');
  area.getState().restore(pane('c'), 'c', { id: 'workspace:other', createdAt: 2 });
  expect(workbench.getState().snapshot.tabs).toHaveLength(2);
});

it('rejects restoring resources into a scope that cannot own them', () => {
  const workbench = createWorkbenchStore('scope-validation');
  const area = createPaneWorkspaceStore('code', workbench);
  area.getState().restore({ type: 'pane', id: 'chat', resourceId: 'chat:one' }, 'chat');
  expect(workbench.getState().snapshot.tabs).toEqual([]);
});

it('projects external layout, focus, zoom and history updates into the canonical owner', () => {
  const { workbench, area } = setup();
  area.setState({ layout: pane('a'), focused: 'a' });
  expect(workbench.getState().snapshot.tabs[0]!.layout).toEqual(pane('a'));
  area.setState({ focused: 'missing' }); expect(area.getState().focused).toBe('a');
  area.setState({ zoomed: 'a' }); expect(workbench.getState().snapshot.tabs[0]!.zoomed).toBe('a');
  area.setState({ historyIdentity: { id: 'workspace:saved', createdAt: 1 } }); expect(workbench.getState().snapshot.tabs[0]!.historyIdentity?.id).toBe('workspace:saved');
  workbench.getState().update(state => selectContainer(putContainer(state, tab('foreign', null)), 'foreign'));
  area.setState({ layout: pane('b'), focused: 'b' }); expect(workbench.getState().snapshot.tabs.find(tab => tab.id === 'foreign')!.layout).toEqual(pane('b'));
  workbench.setState({ snapshot: emptyWorkbench() }); area.setState({ layout: null, focused: 'missing' }); expect(workbench.getState().snapshot.tabs).toEqual([]);
});
