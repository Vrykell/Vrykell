import { t } from '@i18n';
import { applyTabGroups } from '@platform/api/group';
import { useWorkspaceStore, isSessionTab } from '../stores/workspace';
import type { GroupingProposal } from '@features/agent/services/autoGrouping';

export async function applySessionGrouping(proposals: GroupingProposal[]): Promise<void> {
  const before = useWorkspaceStore.getState();
  const active = new Set(before.tabs.filter(isSessionTab).map(tab => tab.id));
  if (proposals.some(group => group.itemIds.some(id => !active.has(id)))) throw new Error(t('Items changed. Generate a new grouping plan.'));
  const assignments = proposals.map(proposal => ({
    id: before.groups.find(group => group.title.toLowerCase() === proposal.name.toLowerCase())?.id ?? crypto.randomUUID(),
    title: proposal.name, itemIds: proposal.itemIds,
  }));
  await applyTabGroups(assignments);
  useWorkspaceStore.setState(state => {
    const groups = [...state.groups]; let tabs = [...state.tabs];
    for (const group of assignments) {
      if (!groups.some(entry => entry.id === group.id)) groups.push({ id: group.id, title: group.title, collapsed: false });
      const moved = group.itemIds.flatMap(id => { const tab = tabs.find(tab => tab.id === id); return tab && isSessionTab(tab) ? [{ ...tab, groupId: group.id }] : []; });
      tabs = [...tabs.filter(tab => !group.itemIds.includes(tab.id)), ...moved];
    }
    return { groups, tabs };
  });
  useWorkspaceStore.getState().pruneEmptyGroups();
}
