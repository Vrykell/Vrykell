import { useEffect } from 'react';
import { t } from '@i18n';
import { tabCapabilities, type TabHandle } from '@ui/layout/tabHandle';
import IconCountBadge from '@ui/feedback/IconCountBadge';
import { Grid } from '@ui/icons';
import { isHistoryGroupColor } from '@ui/history/historyGroupColor';
import { useWorkbenchStore } from '../stores/workbench';
import { useWorkspaceNavigation } from '../stores/navigation';
import { moveContainer, moveWorkspaceEntity, panesOf, workspaceStripEntities, type WorkspaceScope } from '../model/workbench';
import type { WorkspaceTabStrip } from '../model/tabStrip';
import { activateContainer, assignWorkspaceGroup, closeContainer, createContainerGroup, detachWorkspacePane, focusNativeContainerResource, persistWorkspaceOrder, removeContainerPane, removeWorkspaceGroup, renameContainer, synchronizeWorkbench, updateWorkspaceGroup } from '../services/workbench';
import { reportWorkbenchFailure } from '../stores/workbenchFeedback';
import { workspaceAreaStores } from '../stores/paneWorkspace';
import { useUiStore } from '../stores/ui';
import { requestWorkspaceSplit } from '../services/unifiedWorkspace';

/** Every strip row is a layout-owning container, including a one-resource tab. */
export function useWorkspaceContainerTabs(scope: WorkspaceScope, resourceHandles: TabHandle[], selectedResource?: string, utilityIds: readonly string[] = []): WorkspaceTabStrip {
  const snapshot = useWorkbenchStore(state => state.snapshot);
  const colors = useWorkspaceNavigation(state => state.groupColors);
  const signature = resourceHandles.map(handle => handle.id).join('|');
  useEffect(() => { synchronizeWorkbench(); }, [signature]);
  useEffect(() => {
    if (selectedResource && useWorkspaceNavigation.getState().area === scope) focusNativeContainerResource(selectedResource);
  }, [scope, selectedResource]);
  const tabs = snapshot.tabs.filter(tab => tab.scope === scope);
  const groups = snapshot.groups.filter(group => group.scope === scope);
  const handlesById = new Map(resourceHandles.map(handle => [handle.id, handle]));
  const run = (operation: () => void | Promise<unknown>) => {
    const retry = () => { void Promise.resolve().then(operation).catch(error => reportWorkbenchFailure(error, retry)); };
    retry();
  };
  return {
    selected: snapshot.selected[scope],
    handles: tabs.filter(tab => tab.layout || scope === 'unified').map(tab => {
      if (!tab.layout) return { id: tab.id, label: t('Start'), tip: t('Start'), icon: <Grid size={16} />, closeLabel: t('Close this tab'), surface: 'canvas' as const, capabilities: tabCapabilities(), dataAttributes: { 'data-tab-row-id': tab.id, 'data-workspace-scope': scope } };
      const members = panesOf(tab).flatMap(pane => { const handle = handlesById.get(pane.resourceId); return handle ? [handle] : []; });
      const first = members[0];
      const title = tab.title || members.map(handle => handle.label).join(' + ') || t('Start');
      return { ...first, id: tab.id, label: title, tip: title,
        icon: <IconCountBadge count={members.length}>{first?.icon ?? <Grid size={16} />}</IconCountBadge>,
        closeLabel: first?.closeLabel ?? t('Close this tab'), capabilities: tabCapabilities({ renameable: true, groupable: true }),
        dataAttributes: { ...first?.dataAttributes, 'data-tab-row-id': tab.id, 'data-tab-group': tab.groupId ?? '', 'data-workspace-scope': scope },
      };
    }),
    onSelect: activateContainer,
    onClose: closeContainer,
    onMove: (id, over, after) => {
      if (utilityIds.includes(id) || utilityIds.includes(over)) {
        useWorkbenchStore.getState().update(state => moveWorkspaceEntity(state, scope, `tab:${id}`, `tab:${over}`, after, utilityIds));
        run(() => persistWorkspaceOrder(scope)); return;
      }
      // Capture the destination group before synchronization can restore the native member state.
      const groupId = useWorkbenchStore.getState().snapshot.tabs.find(tab => tab.id === over)?.groupId;
      useWorkbenchStore.getState().update(state => moveContainer(state, id, over, after, utilityIds));
      run(() => assignWorkspaceGroup(id, groupId));
    },
    onRename: renameContainer,
    tabActions: id => {
      const tab = tabs.find(tab => tab.id === id); if (!tab?.layout) return [];
      const cells = panesOf(tab); const focused = cells.find(pane => pane.id === tab.focused) ?? cells[0]!;
      const peers = tabs.filter(peer => peer.id !== id && peer.layout && panesOf(peer).length + cells.length <= 4);
      return [
        ...(cells.length < 4 ? [{ label: t('Split tab'), onClick: () => { activateContainer(id); requestWorkspaceSplit(focused.resourceId); } }] : []),
        ...[
          { label: t('Change pane position'), disabled: cells.length < 2, onClick: () => { activateContainer(id); useUiStore.getState().beginPaneMove(id, focused.id); } },
          { label: t('Move pane to new tab'), disabled: cells.length < 2, onClick: () => { activateContainer(id); detachWorkspacePane(scope, focused.resourceId); } },
          { label: t('Remove pane'), disabled: cells.length < 2, onClick: () => removeContainerPane(id, focused.resourceId) },
        ],
        ...(peers.length ? [{ label: t('Merge tab into this tab'), submenu: { items: peers.map(peer => ({ label: peer.title || panesOf(peer).map(pane => handlesById.get(pane.resourceId)?.label ?? '').join(' + '),
          onClick: () => { activateContainer(id); workspaceAreaStores[scope].getState().chooseMerge(peer.id); } })) } }] : []),
      ];
    },
    grouping: {
      groups: groups.map(group => {
        const members = tabs.filter(tab => tab.groupId === group.id);
        return { ...group, members: members.map(tab => tab.id), archivable: members.some(tab => tab.restoreSnapshot?.members.some(member => member.kind === 'terminal' || member.kind === 'conversation' || member.kind === 'agent')) };
      }), colors,
      order: workspaceStripEntities(snapshot, scope, [...utilityIds, ...resourceHandles.filter(handle => handle.surface === 'canvas').map(handle => handle.id)]),
      create: async id => {
        const groupId = `group:${scope}:${crypto.randomUUID()}`;
        const create = () => createContainerGroup(id, undefined, groupId);
        try { return await create(); }
        catch (error) { reportWorkbenchFailure(error, () => run(create)); return undefined; }
      }, assign: (id, groupId) => run(() => assignWorkspaceGroup(id, groupId)),
      rename: (id, title) => run(() => updateWorkspaceGroup(id, { title })), collapse: (id, collapsed) => run(() => updateWorkspaceGroup(id, { collapsed })),
      remove: (id, mode) => { const retry = () => removeWorkspaceGroup(id, mode, error => reportWorkbenchFailure(error, retry)); retry(); },
      color: (id, value) => { if (value === null || isHistoryGroupColor(value)) useWorkspaceNavigation.getState().setGroupColor(id, value); },
      move: (id, over, after) => { useWorkbenchStore.getState().update(state => {
        const entity = (entityId?: string) => entityId ? state.groups.some(group => group.id === entityId) ? `group:${entityId}` : `tab:${entityId}` : undefined;
        return moveWorkspaceEntity(state, scope, entity(id)!, entity(over), after, utilityIds);
      }); run(() => persistWorkspaceOrder(scope)); },
    },
  };
}
