import { afterEach, expect, it } from 'vitest';
import { useUnifiedWorkspace } from '../stores/unifiedWorkspace';
import { fitWorkspacePanes, parseWorkspacePaneLayout, workspacePaneCells, workspacePaneIds } from '../model/workspaceResources';
const initial = useUnifiedWorkspace.getState();
afterEach(() => useUnifiedWorkspace.setState(initial, true));

it('shares one ordered strip and mixed layout while retaining live identities through replacement and missing resources', () => {
  const state = useUnifiedWorkspace.getState(); state.reconcile(['terminal:one', 'file:two', 'chat:three', 'acp:four', 'file:five']);
  state.split('file:two', 'row'); state.split('chat:three', 'col'); state.split('acp:four', 'row');
  expect(workspacePaneIds(useUnifiedWorkspace.getState().layout!)).toEqual(['terminal:one', 'file:two', 'chat:three', 'acp:four']);
  state.split('file:five', 'row'); expect(workspacePaneIds(useUnifiedWorkspace.getState().layout!)).toHaveLength(4);
  const first = workspacePaneCells(useUnifiedWorkspace.getState().layout!)[0]!;
  state.show(first.resourceId); expect(useUnifiedWorkspace.getState().focused).toBe(first.id);
  state.show('file:five'); expect(workspacePaneCells(useUnifiedWorkspace.getState().layout!)[0]).toMatchObject({ id: first.id, resourceId: 'file:five' });
  state.reconcile(['file:two', 'chat:three']); expect(workspacePaneIds(useUnifiedWorkspace.getState().layout!)).toEqual(['file:two', 'chat:three']);
  state.single(); expect(workspacePaneIds(useUnifiedWorkspace.getState().layout!)).toHaveLength(1);
});

it('validates restored layouts, rejects duplicate owners and clamps resize ratios', () => {
  const state = useUnifiedWorkspace.getState(); state.reconcile(['file:one', 'chat:two']); state.split('chat:two', 'row');
  const layout = useUnifiedWorkspace.getState().layout!;
  const cells = workspacePaneCells(layout); state.ratio(cells[0]!.id, cells[1]!.id, 5);
  expect(workspacePaneCells(useUnifiedWorkspace.getState().layout!)[0]!.rect.w).toBe(0.8);
  expect(parseWorkspacePaneLayout(JSON.parse(JSON.stringify(layout)))).toEqual(layout);
  expect(parseWorkspacePaneLayout({ type: 'split', direction: 'row', ratio: 0.5, first: cells[0], second: cells[0] })).toBeNull();
  state.move(['file:one', 'chat:two'], 'chat:two', 'file:one', false);
  expect(useUnifiedWorkspace.getState().order).toEqual(['chat:two', 'file:one']);
});

it('keeps controls usable at extreme split ratios and stacks narrow panes with an owned scroller', () => {
  const state = useUnifiedWorkspace.getState(); state.reconcile(['file:one', 'terminal:two', 'chat:three', 'acp:four']);
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
