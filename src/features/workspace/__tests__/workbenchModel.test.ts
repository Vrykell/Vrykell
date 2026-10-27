import { describe, expect, it } from 'vitest';
import { acceptsWorkspaceResource, assignContainerGroup, detachContainerPane, emptyWorkbench, focusContainerResource, mergeContainers, moveContainer, moveContainerPane, moveWorkspaceEntity, normalizeContainer, panesOf, parseWorkbench, placeContainerResource, putContainer, reconcileContainers, removeContainers, selectContainer, workspaceStripEntities, WORKSPACE_SCOPES, type WorkbenchSnapshot, type WorkspaceContainer, type WorkspaceScope } from '../model/workbench';
import { workspacePaneIds, type WorkspacePaneLayout } from '../model/workspaceResources';

const pane = (id: string, resourceId = `file:${id}`): Extract<WorkspacePaneLayout, { type: 'pane' }> => ({ type: 'pane', id, resourceId });
const tab = (id: string, scope: WorkspaceScope = 'code', layout: WorkspacePaneLayout | null = pane(id)): WorkspaceContainer => ({ id, scope, layout, focused: id, zoomed: null });
const pair: WorkspacePaneLayout = { type: 'split', direction: 'row', ratio: 0.5, first: pane('a'), second: pane('b') };
const target = { leafId: 'a', dir: 'col' as const, position: 'first' as const };
function state(...tabs: WorkspaceContainer[]): WorkbenchSnapshot { return { ...emptyWorkbench(), tabs }; }

describe('layout-owning workspace containers', () => {
  it.each(WORKSPACE_SCOPES)('keeps independent layouts, focus and zoom in %s', scope => {
    const prefix = scope === 'terminal' ? 'terminal:' : scope === 'ai' ? 'chat:' : 'file:';
    const layout: WorkspacePaneLayout = { ...pair, first: pane('a', `${prefix}a`), second: pane('b', `${prefix}b`) };
    let snapshot = state(tab('one', scope, layout), tab('two', scope, pane('c', `${prefix}c`)));
    snapshot = selectContainer(snapshot, 'one');
    expect(snapshot.selected[scope]).toBe('one');
    const focused = focusContainerResource(snapshot, scope, `${prefix}b`);
    expect(focused.tabs[0]!.focused).toBe('b');
    const zoomed = putContainer(focused, { ...focused.tabs[0]!, zoomed: 'b' });
    const switched = selectContainer(zoomed, 'two');
    expect(switched.tabs[0]!.layout).toBe(layout);
    expect(switched.tabs[0]!.zoomed).toBe('b');
    expect(panesOf(switched.tabs[1]!)).toHaveLength(1);
  });

  it('normalizes missing focus and stale zoom while retaining valid focus and zoom', () => {
    const original = { ...tab('a'), zoomed: 'a' };
    expect(normalizeContainer(original)).toBe(original);
    expect(normalizeContainer({ ...tab('x', 'code', pair), zoomed: 'gone' })).toMatchObject({ focused: 'a', zoomed: null });
    expect(normalizeContainer({ ...tab('x', 'code', null), zoomed: 'gone' })).toMatchObject({ focused: '', zoomed: null });
    expect(normalizeContainer({ ...tab('a', 'code', pair), zoomed: 'b' }).zoomed).toBe('b');
    expect(panesOf(tab('empty', 'code', null))).toEqual([]);
  });

  it('rejects cross-scope identity reuse and replaces only the requested tab', () => {
    const original = state(tab('a'));
    expect(putContainer(original, tab('a', 'ai'))).toBe(original);
    expect(putContainer(original, { ...tab('a'), title: 'Renamed' }).tabs).toEqual([{ ...tab('a'), title: 'Renamed' }]);
    expect(putContainer(original, tab('b')).tabs).toHaveLength(2);
    const withStart = state(tab('start', 'code', null), tab('other', 'ai', null));
    const selectedStart = selectContainer(withStart, 'start');
    const added = putContainer(selectedStart, tab('a'));
    expect(added.tabs.map(tab => tab.id)).toEqual(['other', 'a']);
    expect(added.selected.code).toBe('a');
    expect(putContainer(original, tab('empty', 'code', null)).tabs).toHaveLength(2);
    expect(selectContainer(original, 'gone')).toBe(original);
    expect(focusContainerResource(original, 'ai', 'file:a')).toBe(original);
    expect(focusContainerResource(original, 'code', 'missing')).toBe(original);
  });

  it('selects the nearest surviving tab in the same scope after close', () => {
    let original = state(tab('a'), tab('foreign', 'ai'), tab('b'), tab('c'));
    original = selectContainer(original, 'b');
    const closed = removeContainers(original, new Set(['b']));
    expect(closed.selected.code).toBe('c');
    expect(closed.selected.ai).toBe('foreign');
    expect(removeContainers(selectContainer(original, 'c'), new Set(['c'])).selected.code).toBe('b');
    expect(removeContainers(state(tab('a')), new Set(['a'])).selected.code).toBeUndefined();
    expect(removeContainers(original, new Set()).selected.code).toBe('b');
  });

  it('prunes all closed resources while preserving unrelated scopes and surviving pane identities', () => {
    const original = state({ ...tab('one', 'code', pair), focused: 'b', zoomed: 'b' }, tab('two', 'code', pane('c')), tab('other', 'ai'), tab('start', 'code', null));
    const same = reconcileContainers(original, 'code', new Set(['file:a', 'file:b', 'file:c']));
    expect(same.tabs[0]).toBe(original.tabs[0]);
    const pruned = reconcileContainers(original, 'code', new Set(['file:a']));
    expect(pruned.tabs.find(tab => tab.id === 'one')).toMatchObject({ layout: pane('a'), focused: 'a', zoomed: null });
    expect(pruned.tabs.map(tab => tab.id)).toEqual(['one', 'other', 'start']);
  });

  it.each(['first', 'second'] as const)('moves a resource between tabs on the %s side without duplicating it', position => {
    const original = state(tab('one', 'code', pane('a')), { ...tab('two', 'code', pair), focused: 'b' }, tab('foreign', 'ai', pane('b')));
    const result = placeContainerResource(original, 'one', pane('b'), { ...target, position });
    expect(result.selected.code).toBe('one');
    expect(panesOf(result.tabs.find(tab => tab.id === 'one')!).map(pane => pane.id)).toEqual(position === 'first' ? ['b', 'a'] : ['a', 'b']);
    expect(result.tabs.find(tab => tab.id === 'two')!.layout).toEqual(pane('a'));
    expect(result.tabs.find(tab => tab.id === 'foreign')).toBe(original.tabs[2]);
    expect(placeContainerResource(state(tab('one')), 'one', pane('a'), target)).toMatchObject(state(tab('one')));
  });

  it('removes a source tab emptied by placement and ignores stale, full and duplicate targets', () => {
    const original = state(tab('one', 'code', pane('a')), tab('two', 'code', pane('b')), tab('empty', 'code', null));
    expect(placeContainerResource(original, 'gone', pane('b'), target)).toBe(original);
    expect(placeContainerResource(original, 'empty', pane('b'), target)).toBe(original);
    expect(placeContainerResource(original, 'one', pane('b'), { ...target, leafId: 'gone' })).toBe(original);
    const placed = placeContainerResource(original, 'one', pane('b'), target);
    expect(placed.tabs.map(tab => tab.id)).toEqual(['one']);
    const full: WorkspacePaneLayout = { type: 'split', direction: 'col', ratio: 0.5, first: pair, second: { ...pair, first: pane('c'), second: pane('d') } };
    const four = state(tab('full', 'code', full));
    expect(placeContainerResource(four, 'full', pane('fifth'), target)).toBe(four);
    expect(placeContainerResource(state(tab('one', 'code', pair)), 'one', pane('new', 'file:b'), target).tabs[0]!.layout).toBe(pair);
  });

  it('moves one pane inside its container while retaining pane identity', () => {
    const original = state({ ...tab('one', 'code', pair), focused: 'a', zoomed: 'b' });
    const moved = moveContainerPane(original, 'one', 'b', target);
    expect(panesOf(moved.tabs[0]!).map(pane => pane.id)).toEqual(['b', 'a']);
    expect(moved.tabs[0]).toMatchObject({ focused: 'b', zoomed: null });
    expect(panesOf(moved.tabs[0]!).find(pane => pane.id === 'b')?.resourceId).toBe('file:b');
    expect(moveContainerPane(original, 'one', 'b', { ...target, leafId: 'b' })).toBe(original);
    expect(moveContainerPane(original, 'one', 'missing', target)).toBe(original);
    expect(moveContainerPane(original, 'one', 'b', { ...target, leafId: 'missing' })).toBe(original);
    expect(moveContainerPane(original, 'missing', 'b', target)).toBe(original);
    const single = state(tab('one'));
    expect(moveContainerPane(single, 'one', 'a', target)).toBe(single);
    const empty = state(tab('empty', 'code', null));
    expect(moveContainerPane(empty, 'empty', 'a', target)).toBe(empty);
    const duplicate = state(tab('one', 'code', { ...pair, second: pane('b', 'file:a') }));
    expect(moveContainerPane(duplicate, 'one', 'b', target)).toBe(duplicate);
  });

  it('detaches into the same scope and group with the exact pane identity', () => {
    const original = state({ ...tab('one', 'code', pair), focused: 'a', zoomed: 'b', groupId: 'g' });
    const result = detachContainerPane(original, 'one', 'b', 'new');
    expect(result.tabs[0]).toMatchObject({ focused: 'a', zoomed: null, layout: pane('a') });
    expect(result.tabs[1]).toMatchObject({ scope: 'code', groupId: 'g', focused: 'b', layout: pane('b') });
    expect(result.selected.code).toBe('new');
    expect(detachContainerPane(original, 'gone', 'a', 'new')).toBe(original);
    expect(detachContainerPane(original, 'one', 'a', 'one')).toBe(original);
    expect(detachContainerPane(original, 'one', 'gone', 'new')).toBe(original);
    const single = state(tab('one'));
    expect(detachContainerPane(single, 'one', 'one', 'new')).toBe(single);
    expect(detachContainerPane(state(tab('empty', 'code', null)), 'empty', 'a', 'new').tabs).toHaveLength(1);
  });

  it.each(['first', 'second'] as const)('merges complete trees on the %s side and keeps the target focus', position => {
    const original = state(tab('source', 'code', pair), { ...tab('target', 'code', pane('c')), focused: 'c' });
    const merged = mergeContainers(original, 'source', 'target', { leafId: 'c', dir: 'row', position });
    expect(merged.tabs).toHaveLength(1);
    expect(workspacePaneIds(merged.tabs[0]!.layout!)).toEqual(position === 'first' ? ['file:a', 'file:b', 'file:c'] : ['file:c', 'file:a', 'file:b']);
    expect(merged.selected.code).toBe('target');
    expect(merged.tabs[0]!.focused).toBe('c');
  });

  it('rejects invalid merges, including duplicate pane and resource ownership', () => {
    const original = state(tab('source', 'code', pair), tab('target', 'code', pane('c')), tab('ai', 'ai', pane('x')), tab('empty', 'code', null));
    for (const [source, destination] of [['missing', 'target'], ['source', 'missing'], ['source', 'source'], ['source', 'ai'], ['empty', 'target'], ['source', 'empty']]) expect(mergeContainers(original, source!, destination!, target)).toBe(original);
    expect(mergeContainers(original, 'source', 'target', target)).toBe(original);
    const overlapping = state(tab('one', 'code', pair), tab('two', 'code', pane('b')));
    expect(mergeContainers(overlapping, 'one', 'two', { ...target, leafId: 'b' })).toBe(overlapping);
    const three: WorkspacePaneLayout = { type: 'split', direction: 'row', ratio: 0.5, first: pair, second: pane('c') };
    const tooMany = state(tab('one', 'code', three), tab('two', 'code', { ...pair, first: pane('d'), second: pane('e') }));
    expect(mergeContainers(tooMany, 'one', 'two', { ...target, leafId: 'd' })).toBe(tooMany);
    const nested = state(tab('one', 'code', pane('c')), tab('two', 'code', pair));
    expect(panesOf(mergeContainers(nested, 'one', 'two', { ...target, leafId: 'b' }).tabs[0]!)).toHaveLength(3);
  });

  it('assigns and reorders group members only inside the owning scope', () => {
    const original = { ...state(tab('a'), tab('b'), tab('ai', 'ai')), groups: [{ id: 'g', scope: 'code' as const, title: 'Work', collapsed: false }] };
    const grouped = assignContainerGroup(original, 'a', 'g');
    expect(grouped.tabs[0]!.groupId).toBe('g');
    expect(assignContainerGroup(grouped, 'a', undefined).tabs[0]!.groupId).toBeUndefined();
    expect(assignContainerGroup(original, 'ai', 'g')).toBe(original);
    expect(assignContainerGroup(original, 'a', 'missing')).toBe(original);
    expect(assignContainerGroup(original, 'missing', 'g')).toBe(original);
    const moved = moveContainer(grouped, 'b', 'a', false);
    expect(moved.tabs.map(tab => tab.id)).toEqual(['b', 'a', 'ai']);
    expect(moved.tabs[0]!.groupId).toBe('g');
    expect(moveContainer(grouped, 'b', 'a', true).tabs.map(tab => tab.id)).toEqual(['a', 'b', 'ai']);
    for (const [id, over] of [['missing', 'a'], ['a', 'missing'], ['a', 'ai'], ['a', 'a']]) expect(moveContainer(original, id!, over!, false)).toBe(original);
  });
});

describe('bounded versioned workspace snapshots', () => {
  it('keeps group chips and loose tabs in one persistent order and rejects stale moves', () => {
    const original = { ...state({ ...tab('a'), groupId: 'g' }, tab('b'), { ...tab('orphan'), groupId: 'gone' }, tab('foreign', 'ai')), groups: [{ id: 'g', scope: 'code' as const, title: 'Work', collapsed: false }] };
    expect(workspaceStripEntities(original, 'code')).toEqual(['group:g', 'tab:b', 'tab:orphan']);
    const moved = moveWorkspaceEntity(original, 'code', 'group:g', 'tab:b', true);
    expect(workspaceStripEntities(moved, 'code')).toEqual(['tab:b', 'group:g', 'tab:orphan']);
    const last = moveWorkspaceEntity(moved, 'code', 'tab:b'); expect(workspaceStripEntities(last, 'code')).toEqual(['group:g', 'tab:orphan', 'tab:b']);
    expect(moveWorkspaceEntity(last, 'code', 'missing')).toBe(last);
    expect(moveWorkspaceEntity(last, 'code', 'tab:b', 'tab:b')).toBe(last);
    expect(moveWorkspaceEntity(last, 'code', 'tab:b', 'missing')).toBe(last);
  });
  it('round trips tabs, groups, selection and bounded restoration references', () => {
    const original = { ...state({ ...tab('one', 'code', pair), focused: 'b', zoomed: 'a', groupId: 'g', title: 'Project', historyIdentity: { id: 'workspace:saved', createdAt: 1 } }), selected: { code: 'one' }, groups: [{ id: 'g', scope: 'code' as const, title: 'Work', collapsed: true }] };
    expect(parseWorkbench(JSON.parse(JSON.stringify(original)))).toMatchObject(original);
    expect(parseWorkbench(emptyWorkbench())).toMatchObject({ tabs: [], groups: [] });
    expect(parseWorkbench(state(tab('start', 'code', null)))!.tabs[0]!.focused).toBe('');
    expect(parseWorkbench(null)).toBeNull();
    expect(parseWorkbench({ ...original, version: 1 })).toBeNull();
    expect(parseWorkbench({ ...original, tabs: [original.tabs[0], original.tabs[0]] })).toBeNull();
    expect(parseWorkbench({ ...original, groups: [...original.groups, ...original.groups] })).toBeNull();
    expect(parseWorkbench({ ...original, groups: [] })).toBeNull();
    expect(parseWorkbench({ ...original, groups: [{ ...original.groups[0], scope: 'ai' }] })).toBeNull();
    expect(parseWorkbench(state(tab('one'), tab('two', 'code', pane('a', 'file:one'))))).toBeNull();
    expect(parseWorkbench(state(tab('one'), tab('two', 'unified', pane('a', 'file:one'))))).not.toBeNull();
    expect(parseWorkbench(state(tab('one', 'ai')))).toBeNull();
  });

  it('sanitizes malformed optional restore metadata and normalizes the selected tab', () => {
    const original = state({ ...tab('a'), restoreSnapshot: { version: 1, layout: pane('a'), focused: 'a', members: [{ id: 'file:a', title: 'A', kind: 'document', reference: '/a', paneCount: 1, local: true, ssh: false }] } });
    const parsed = parseWorkbench(original)!;
    expect(parsed.tabs[0]!.restoreSnapshot).toEqual(original.tabs[0]!.restoreSnapshot);
    expect(parseWorkbench({ ...original, tabs: [{ ...tab('a'), restoreSnapshot: false }] })).toBeNull();
    expect(parsed.selected.code).toBe('a');
    expect(parseWorkbench({ ...original, tabs: [{ ...tab('a'), layout: { nope: true } }] })).toBeNull();
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    expect(parseWorkbench({ ...original, tabs: [{ ...tab('a'), restoreSnapshot: cyclic }] })).toBeNull();
  });

  it('rejects resources that violate the owning workspace capabilities', () => {
    expect(acceptsWorkspaceResource('ai', 'chat:')).toBe(false);
    expect(acceptsWorkspaceResource('ai', 'acp:agent')).toBe(true);
    expect(acceptsWorkspaceResource('code', 'diff:one')).toBe(true);
    expect(acceptsWorkspaceResource('unified', 'page:settings')).toBe(false);
    const original = state(tab('one'));
    expect(putContainer(original, tab('two', 'ai', pane('b')))).toBe(original);
    expect(placeContainerResource(original, 'one', pane('a', 'chat:wrong'), { leafId: 'one', dir: 'row', position: 'first' })).toBe(original);
  });
});
