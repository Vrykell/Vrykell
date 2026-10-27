import { useCallback, useMemo } from 'react';
import { useSessionStore, nextTerminalId } from '@features/workspace';
import { useTerminalStore } from '@features/terminal';
import { useUiStore } from '@features/workspace';
import { defaultOpenModeForShell } from '@features/agent';
import {
  dropTargets,
  findLeaf,
  removeLeaf,
  setRatio,
  splitLeaf,
  type DropTarget,
  type WindowLayout,
} from '@features/workspace/model/windowLayout';

interface UseTerminalLayoutActionsOptions {
  windowId: string;
  layout: WindowLayout;
}

/**
 * Layout actions for a terminal window: split, move and divider ratios.
 *
 * Components render placement targets and trigger callbacks; layout mutation and UI state stay
 * here so TerminalView does not also own layout algorithms, store writes and view orchestration.
 */
export function useTerminalLayoutActions({ windowId, layout }: UseTerminalLayoutActionsOptions) {
  const setWindowLayout = useSessionStore((state) => state.setWindowLayout);
  const setFocusedPane = useTerminalStore((state) => state.setFocusedPane);
  const splitPlacement = useUiStore((state) => state.splitPlacement);
  const cancelSplit = useUiStore((state) => state.cancelSplit);

  const placementTargets = useMemo(
    () => (splitPlacement.open ? dropTargets(layout) : []),
    [layout, splitPlacement.open],
  );

  const commitPlacement = useCallback((zone: DropTarget) => {
    const base = splitPlacement.spec ?? findLeaf(layout, zone.leafId);
    if (!base) return;

    const newId = nextTerminalId(windowId, layout);
    const openMode = base.openMode ?? (base.kind === 'ssh'
      ? 'classic'
      : defaultOpenModeForShell(base.shellType));
    const next = splitLeaf(layout, zone.leafId, zone.dir, zone.position, {
      ...base,
      id: newId,
      openMode,
    });
    setWindowLayout(windowId, next);
    setFocusedPane(newId);
    cancelSplit();
  }, [cancelSplit, layout, setFocusedPane, setWindowLayout, splitPlacement.spec, windowId]);

  const commitMove = useCallback((dragId: string, zone: DropTarget) => {
    if (zone.leafId === dragId) return;
    const spec = findLeaf(layout, dragId);
    const removed = removeLeaf(layout, dragId);
    if (!spec || !removed) return;

    const next = splitLeaf(removed, zone.leafId, zone.dir, zone.position, spec);
    setWindowLayout(windowId, next);
    setFocusedPane(dragId);
  }, [layout, setFocusedPane, setWindowLayout, windowId]);

  const setRatioNode = useCallback((aId: string, bId: string, ratio: number) => {
    setWindowLayout(windowId, setRatio(layout, aId, bId, ratio));
  }, [layout, setWindowLayout, windowId]);

  return {
    splitPlacement,
    cancelSplit,
    placementTargets,
    commitPlacement,
    commitMove,
    setRatioNode,
  };
}
