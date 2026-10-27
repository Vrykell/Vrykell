import { beforeEach, expect, it } from 'vitest';
import { compositionTabs, selectCompositionTab, useUnifiedWorkspace } from '../stores/unifiedWorkspace';
import { useWorkspaceStore } from '../stores/workspace';
import { fitWorkspacePanes, parseWorkspacePaneLayout, workspacePaneCells, workspacePaneIds, workspaceSplitDirection } from '../model/workspaceResources';
beforeEach(() => { useWorkspaceStore.setState({ tabs: [], activeId: '' }); useUnifiedWorkspace.setState({ activeTabId: '', layout: null, focused: '', historyIdentity: undefined }); });

it('retains each tab layout while switching resources and pruning missing content', () => {
  const state = useUnifiedWorkspace.getState(); state.reconcile(['terminal:one', 'file:two', 'chat:three', 'acp:four', 'file:five']);
  state.show('terminal:one');
  state.split('file:two', 'row'); state.split('chat:three', 'col'); state.split('acp:four', 'row');
  expect(workspacePaneIds(useUnifiedWorkspace.getState().layout!)).toEqual(['terminal:one', 'file:two', 'chat:three', 'acp:four']);
  state.split('file:five', 'row'); expect(workspacePaneIds(useUnifiedWorkspace.getState().layout!)).toHaveLength(4);
  const first = workspacePaneCells(useUnifiedWorkspace.getState().layout!)[0]!;
  const original = useUnifiedWorkspace.getState().layout;
  const tabId = useUnifiedWorkspace.getState().activeTabId;
  state.show(first.resourceId); expect(useUnifiedWorkspace.getState().focused).toBe(first.id);
  state.show('file:five'); expect(workspacePaneIds(useUnifiedWorkspace.getState().layout!)).toEqual(['file:five']);
  selectCompositionTab(tabId); expect(useUnifiedWorkspace.getState().layout).toBe(original);
  state.reconcile(['file:two', 'chat:three']); expect(workspacePaneIds(useUnifiedWorkspace.getState().layout!)).toEqual(['file:two', 'chat:three']); expect(workspacePaneIds(useUnifiedWorkspace.getState().layout!)).toHaveLength(2);

});

it('validates restored layouts, rejects duplicate owners and clamps resize ratios', () => {
  const state = useUnifiedWorkspace.getState(); state.reconcile(['file:one', 'chat:two']); state.show('file:one'); state.split('chat:two', 'row');
  const layout = useUnifiedWorkspace.getState().layout!;
  const cells = workspacePaneCells(layout); state.ratio(cells[0]!.id, cells[1]!.id, 5);
  expect(workspacePaneCells(useUnifiedWorkspace.getState().layout!)[0]!.rect.w).toBe(0.8);
  expect(parseWorkspacePaneLayout(JSON.parse(JSON.stringify(layout)))).toEqual(layout);
  expect(parseWorkspacePaneLayout({ type: 'split', direction: 'row', ratio: 0.5, first: cells[0], second: cells[0] })).toBeNull();
  state.show('file:third');
  const [one, two] = compositionTabs().map(tab => tab.id);
  state.move([one!, two!], two!, one!, false);
  expect(compositionTabs().map(tab => tab.id)).toEqual([two, one]);
});

it('keeps controls usable at extreme split ratios and stacks narrow panes with an owned scroller', () => {
  const state = useUnifiedWorkspace.getState(); state.reconcile(['file:one', 'terminal:two', 'chat:three', 'acp:four']);
  state.show('file:one');
  state.split('terminal:two', 'row'); state.split('chat:three', 'col'); state.split('acp:four', 'col');
  const layout = useUnifiedWorkspace.getState().layout!;
  const cells = workspacePaneCells(layout); state.ratio(cells[0]!.id, cells[1]!.id, 0.8);
  for (const width of [1032, 760, 500]) {
    const fitted = fitWorkspacePanes(useUnifiedWorkspace.getState().layout!, width, 600);
    for (const cell of workspacePaneCells(fitted.layout)) {
      expect(cell.rect.w * width).toBeGreaterThanOrEqual(Math.min(width, 360) - 0.01);
      expect(cell.rect.h * fitted.height).toBeGreaterThanOrEqual(199.99);
    }
    expect(fitted.height).toBeGreaterThanOrEqual(600);
  }
});

it('marks a responsive direction change so a vertical drag cannot rewrite a horizontal split', () => {
  const layout = { type: 'split' as const, direction: 'row' as const, ratio: 0.5,
    first: { type: 'pane' as const, id: 'left', resourceId: 'file:left' },
    second: { type: 'pane' as const, id: 'right', resourceId: 'file:right' } };
  const fitted = fitWorkspacePanes(layout, 600, 800);
  expect(workspaceSplitDirection(layout, 'left', 'right')).toBe('row');
  expect(workspaceSplitDirection(fitted.layout, 'left', 'right')).toBe('col');
  expect(workspaceSplitDirection(fitWorkspacePanes(layout, 1200, 800).layout, 'left', 'right')).toBe('row');
});
