import { beforeEach, expect, it, vi } from 'vitest';
import { applySessionGrouping } from '../autoGrouping';
const fixture = vi.hoisted(() => ({
  apply: vi.fn(), prune: vi.fn(),
  state: { tabs: [{ id: 'one', kind: 'session', title: 'One', groupId: null as string | null }], groups: [] as { id: string; title: string; collapsed: boolean }[] },
}));
vi.mock('@platform/api/group', () => ({ applyTabGroups: fixture.apply }));
vi.mock('../../stores/workspace', () => ({
  isSessionTab: (tab: { kind: string }) => tab.kind === 'session',
  useWorkspaceStore: {
    getState: () => ({ ...fixture.state, pruneEmptyGroups: fixture.prune }),
    setState: (update: (state: typeof fixture.state) => typeof fixture.state) => { fixture.state = update(fixture.state); },
  },
}));
beforeEach(() => { vi.clearAllMocks(); fixture.state = { tabs: [{ id: 'one', kind: 'session', title: 'One', groupId: null }], groups: [] }; fixture.apply.mockResolvedValue(undefined); });
it('updates membership only after the reviewed plan is persisted', async () => {
  await applySessionGrouping([{ name: 'Work', itemIds: ['one'] }]);
  expect(fixture.apply).toHaveBeenCalledOnce();
  expect(fixture.state.groups[0]?.title).toBe('Work');
  expect(fixture.state.tabs[0]?.groupId).toBe(fixture.state.groups[0]?.id);
});
it('keeps the current UI on save failure and rejects stale item ids before writing', async () => {
  fixture.apply.mockRejectedValue(new Error('Disk full'));
  await expect(applySessionGrouping([{ name: 'Work', itemIds: ['one'] }])).rejects.toThrow('Disk full');
  expect(fixture.state.groups).toEqual([]); expect(fixture.state.tabs[0]?.groupId).toBeNull();
  fixture.apply.mockClear();
  await expect(applySessionGrouping([{ name: 'Work', itemIds: ['missing'] }])).rejects.toThrow();
  expect(fixture.apply).not.toHaveBeenCalled();
});
