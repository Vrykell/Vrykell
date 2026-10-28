import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import ContextMenu, { type ContextMenuItem } from '@ui/menus/ContextMenu';
import type { DropdownAnchor } from '@ui/menus/AnchoredDropdown';
import type { PaneTarget } from '@core/paneLayout';
import { t } from '@i18n';
import { useWorkspaceResources } from '../hooks/useWorkspaceResources';
import { useScopedPaneActive } from '../hooks/useScopedPaneActive';
import { scopedPaneStores, type PaneWorkspaceScope } from '../stores/scopedPanes';
import { useWorkspaceNavigation } from '../stores/navigation';
import { useUiStore } from '../stores/ui';
import { activateWorkspaceResource, currentWorkspaceResources } from '../services/workspaceResources';
import { createScopedResource } from '../services/scopedPanes';
import { workspacePaneCells } from '../model/workspaceResources';
import WorkspacePaneCanvas from './WorkspacePaneCanvas';
import { useWorkspaceHistory } from '../hooks/useWorkspaceHistory';
import AcpLauncher from './AcpLauncher';
import { requestWorkspaceSplit } from '../services/unifiedWorkspace';
import { pickWorkspaceFile } from '../services/workspaceActions';
import type { EditorFile } from '@core/editor';
import { detachWorkspacePane, mergeWorkspaceContainers, moveWorkspacePane, removeContainerPane } from '../services/workbench';

export default function ScopedPaneWorkspace({ scope, selected, active }: { scope: PaneWorkspaceScope; selected: string; active: boolean }) {
  const store = scopedPaneStores[scope]; const state = store();
  const all = useWorkspaceResources();
  const resources = all.filter(resource => scope === 'code' ? resource.kind === 'document' || resource.kind === 'comparison' : resource.kind === 'conversation' || resource.kind === 'agent');
  useWorkspaceHistory(resources, store);
  const ids = resources.map(resource => resource.id); const key = JSON.stringify(ids);
  const paneActive = useScopedPaneActive(scope);
  const settingsOpen = useUiStore(value => value.settingsOpen);
  const [addition, setAddition] = useState<{ id: string } | { tab: string } | { create: 'document' | 'conversation' } | { harness: string; cwd?: string } | { file: EditorFile } | null>(null);
  const [launcher, setLauncher] = useState<{ anchor: DropdownAnchor } | null>(null);
  const proceeding = useRef(false);
  const visible = active && paneActive && !settingsOpen;
  useLayoutEffect(() => {
    if (!visible || !state.choosingSplit || state.splitAnchor) return;
    const bounds = Array.from(document.querySelectorAll('.workspace-resource-switch-action')).map(button => button.getBoundingClientRect()).find(bounds => bounds.width > 0);
    if (bounds) store.setState({ splitAnchor: { x: bounds.right, y: bounds.bottom + 4 } });
  }, [visible, state.choosingSplit, state.splitAnchor, store]);
  useEffect(() => { state.reconcile(ids); }, [key]);
  useEffect(() => { if (state.pendingMergeTab) setAddition({ tab: state.pendingMergeTab }); }, [state.pendingMergeTab]);
  useEffect(() => { if (active && paneActive && ids.includes(selected)) state.show(selected); }, [active, paneActive, selected]);
  useEffect(() => { if (!active || settingsOpen) { setAddition(null); setLauncher(null); store.setState({ choosingSplit: false }); } }, [active, settingsOpen, store]);
  const focus = (id: string) => {
    const resource = resources.find(item => item.id === id); if (!resource) return;
    state.show(id); activateWorkspaceResource(resource); useWorkspaceNavigation.getState().selectArea(scope);
  };
  const cancel = () => { proceeding.current = false; setAddition(null); state.chooseMerge(); store.setState({ choosingSplit: false }); };
  useEffect(() => {
    if (!active || settingsOpen || !state.choosingSplit || !state.splitCreation) return;
    const kind = state.splitCreation;
    store.setState({ splitCreation: undefined });
    proceeding.current = true;
    if (kind === 'document' || kind === 'conversation') setAddition({ create: kind });
    else if (kind === 'file') void pickWorkspaceFile().then(file => { if (file) setAddition({ file }); else cancel(); });
    else if (kind === 'agent') {
      setLauncher({ anchor: { ...(state.splitAnchor ?? { x: window.innerWidth - 8, y: 80 }), align: 'end' } });
      store.setState({ choosingSplit: false });
    }
  }, [active, settingsOpen, state.choosingSplit, state.splitCreation, store]);
  const commit = (target: PaneTarget) => {
    if (!addition) return;
    if ('tab' in addition) { void mergeWorkspaceContainers(addition.tab, state.activeTabId, target); cancel(); return; }
    const destination = state.activeTabId;
    let id: string | undefined;
    if ('id' in addition) id = addition.id;
    else id = createScopedResource(addition);
    if (id) {
      store.getState().selectTab(destination);
      store.getState().place(id, target);
      const resource = currentWorkspaceResources().find(resource => resource.id === id);
      if (resource) activateWorkspaceResource(resource);
      useWorkspaceNavigation.getState().selectArea(scope);
    }
    cancel();
  };
  const placed = new Set(state.layout ? workspacePaneCells(state.layout).map(cell => cell.resourceId) : []);
  const remove = (id: string) => {
    removeContainerPane(store.getState().activeTabId, id);
  };
  const menuAnchor = { ...(state.splitAnchor ?? { x: window.innerWidth - 8, y: 48 }), align: 'end' as const };
  const items: ContextMenuItem[] = [
    ...resources.filter(resource => !placed.has(resource.id)).map(resource => ({ label: resource.title, onClick: () => { proceeding.current = true; setAddition({ id: resource.id }); } })),
    ...(scope === 'code' ? [
      { label: t('New file'), onClick: () => { proceeding.current = true; setAddition({ create: 'document' as const }); } },
      { label: t('Open file'), onClick: () => { proceeding.current = true; void pickWorkspaceFile().then(file => { if (file) setAddition({ file }); else cancel(); }); } },
    ] : [
      { label: t('New conversation'), onClick: () => { proceeding.current = true; setAddition({ create: 'conversation' as const }); } },
      { label: t('ACP agents'), onClick: () => setLauncher({ anchor: { ...menuAnchor, aboveY: menuAnchor.y - 4 } }) },
    ]),
  ];
  return <section className="scoped-pane-workspace" data-testid={`pane-workspace-${scope}`} style={{ display: visible ? 'flex' : 'none' }}>
    <WorkspacePaneCanvas containerId={state.activeTabId} splitScope={scope} layout={state.layout} focused={state.focused} resources={resources} visible={visible} retainHeader onFocus={focus} onRatio={state.ratio}
      placing={!!addition} onPlace={commit} onCancel={cancel} onSplit={(id, kind) => { focus(id); requestWorkspaceSplit(id, undefined, kind); }} onRemove={remove}
      onMovePane={(paneId, target) => moveWorkspacePane(state.activeTabId, paneId, target)}
      onDetach={id => detachWorkspacePane(scope, id)} />
    {visible && state.choosingSplit && !addition && <ContextMenu anchor={menuAnchor} label={t('Choose a tab to split')} itemRole="menuitem" items={items} onClose={() => { if (!proceeding.current) store.setState({ choosingSplit: false }); proceeding.current = false; }} />}
    <AcpLauncher open={!!launcher} anchor={launcher?.anchor} onClose={() => setLauncher(null)} onPick={(harness, cwd) => {
      setAddition({ harness, cwd }); store.setState({ choosingSplit: true }); setLauncher(null);
    }} />
  </section>;
}
