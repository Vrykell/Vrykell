import { useMemo } from 'react';
import { t } from '@i18n';
import { historyGroupKey, historyRecordKey, scopedGroupIds, useHistoryMetaStore } from '@utils/historyMeta';
import { isHistoryGroupColor } from '../historyGroupColor';
import type { ContextMenuItem } from '../ContextMenu';

/** Group preferences never change automatic membership or the active record filters. */
export function useHistoryGroupActions(scope: 'session' | 'conversation', groupBy: string) {
  const meta = useHistoryMetaStore();
  const pinnedIds = useMemo(() => scopedGroupIds(meta.pinnedGroups, scope, groupBy), [meta.pinnedGroups, scope, groupBy]);
  const keyOf = (id: string) => historyGroupKey(scope, groupBy, id);
  const forGroup = (id: string, title: string, recordIds: readonly string[]) => {
    const key = keyOf(id);
    const keys = recordIds.map(recordId => historyRecordKey(scope, recordId));
    const allStarred = keys.length > 0 && keys.every(recordKey => meta.starred[recordKey]);
    const lockedCount = keys.filter(recordKey => meta.lockedRecords[recordKey]).length;
    const allLocked = keys.length > 0 && lockedCount === keys.length;
    const color = meta.groupColors[key];
    const recordActions: ContextMenuItem[] = [
      { label: t(allStarred ? 'Unstar matching records' : 'Star matching records'), group: 'view', disabled: !keys.length,
        onClick: () => meta.setStarred(keys, !allStarred) },
      { label: t('Lock matching records'), group: 'organize', disabled: !keys.length || allLocked,
        onClick: () => meta.setLocked(keys, true) },
      { label: t('Unlock matching records'), group: 'organize', disabled: !lockedCount,
        onClick: () => meta.setLocked(keys, false) },
    ];
    return {
      title: meta.groupTitles[key] ?? title,
      originalTitle: title,
      note: meta.groupNotes[key],
      collapsed: Boolean(meta.collapsedGroups[key]),
      onCollapsedChange: (value: boolean) => meta.setGroupsCollapsed([key], value),
      pinned: pinnedIds.has(id),
      color: isHistoryGroupColor(color) ? color : undefined,
      onTogglePin: () => meta.togglePinnedGroup(key),
      onSelectColor: (value: string | null) => meta.setGroupColor(key, value),
      onRename: (value: string) => meta.setGroupTitle(key, value.trim() === title ? null : value),
      onNote: (value: string) => meta.setGroupNote(key, value),
      lockedCount,
      recordActions,
    };
  };
  const pageItems = (groupIds: readonly string[], additionalKeys: readonly string[] = []): ContextMenuItem[] => {
    const keys = [...groupIds.map(keyOf), ...additionalKeys];
    return [
      { label: t('Expand all groups'), group: 'view', disabled: !keys.some(key => meta.collapsedGroups[key]),
        onClick: () => meta.setGroupsCollapsed(keys, false) },
      { label: t('Collapse all groups'), group: 'view', disabled: !keys.some(key => !meta.collapsedGroups[key]),
        onClick: () => meta.setGroupsCollapsed(keys, true) },
    ];
  };
  return { meta, pinnedIds, forGroup, pageItems };
}
