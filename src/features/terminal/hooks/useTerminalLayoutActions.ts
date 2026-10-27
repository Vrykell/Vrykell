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
 * 管理终端窗口布局的领域动作：分裂、移动和分隔线比例调整。
 *
 * 组件只负责渲染落点和触发回调，布局变更及 UI 状态收敛在这里，避免
 * TerminalView 同时承担布局算法、Store 读写和视图编排。
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
