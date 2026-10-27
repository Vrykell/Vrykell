import { expect, it } from 'vitest';
import { parseWorkspaceHistory, remapWorkspaceHistory, type WorkspaceHistorySnapshot } from '../model/workspaceHistory';

const snapshot = (): WorkspaceHistorySnapshot => ({ version: 1, focused: 'a', layout: { type: 'pane', id: 'a', resourceId: 'file:a' }, members: [{ id: 'file:a', kind: 'document', title: 'A', reference: '/a', paneCount: 1, local: true, ssh: false }] });
it.each([
  null, 1, 'text', { version: 2 },
  { ...snapshot(), workspaceScope: 'unknown' },
  ...[null, 1, {}, { id: 1 }, { id: '' }, { id: 'a'.repeat(257) }, { id: 'g', title: 1 }, { id: 'g', title: '' }, { id: 'g', title: 'a'.repeat(321) }, { id: 'g', title: 'G', collapsed: 'yes' }].map(group => ({ ...snapshot(), group })),
  { ...snapshot(), focused: 'missing' }, { ...snapshot(), members: [] }, { ...snapshot(), members: [null] },
  ...[
    { id: 1 }, { id: 'file:other' }, { title: 1 }, { title: 'x'.repeat(321) },
    { reference: 1 }, { reference: 'x'.repeat(8193) }, { kind: 1 }, { kind: 'page' }, { local: 1 }, { ssh: 1 },
    { paneCount: 0 }, { paneCount: 5 }, { paneCount: 1.5 }, { cwd: 1 }, { connectionId: 'x'.repeat(4097) },
    { shellType: 1 }, { shellType: 'x'.repeat(65) }, { empty: 1 }, { kind: 'comparison' }, { kind: 'comparison', scope: 'unknown' },
    { modes: 'block' }, { modes: ['unknown'] },
  ].map(patch => ({ ...snapshot(), members: [{ ...snapshot().members[0], ...patch }] })),
])('rejects invalid persisted history metadata %#', value => {
  expect(parseWorkspaceHistory(JSON.stringify(value))).toBeNull();
});

it('bounds payload size and rejects duplicate restore references', () => {
  expect(parseWorkspaceHistory(' '.repeat(65537))).toBeNull();
  const one = snapshot();
  expect(() => remapWorkspaceHistory(one, new Map())).toThrow('could not be restored');
  const two: WorkspaceHistorySnapshot = { ...one, layout: { type: 'split', direction: 'row', ratio: 0.5, first: one.layout, second: { type: 'pane', id: 'b', resourceId: 'file:b' } }, members: [...one.members, { ...one.members[0]!, id: 'file:b' }] };
  expect(() => remapWorkspaceHistory(two, new Map([['file:a', 'file:same'], ['file:b', 'file:same']]))).toThrow('duplicate resources');
  const valid = { ...one, workspaceScope: 'code', group: { id: 'g', title: 'Group', collapsed: true }, members: [{ ...one.members[0], modes: ['block', 'classic'], shellType: 'sh' }] };
  expect(parseWorkspaceHistory(JSON.stringify(valid))).toEqual(valid);
  expect(parseWorkspaceHistory('{')).toBeNull();
});
