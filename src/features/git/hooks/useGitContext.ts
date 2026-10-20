import { useEffect, useMemo } from 'react';
import { useActiveWorkspace } from '@features/workspace';
import type { GitTarget } from '@core/git';
import { useGitContextStore } from '../stores/context';
import { parentOf } from '@platform/path';

export function useGitContext() {
  const { activeTab, activeCwd, focusedSpec, focusedPaneId } = useActiveWorkspace();
  const connectionId = focusedSpec?.kind === 'ssh' ? focusedSpec.ssh?.connectionId : undefined;
  const unavailableConnection = focusedSpec?.kind === 'ssh' && !connectionId;
  const target = useMemo<GitTarget | null>(() => activeCwd && focusedSpec && !unavailableConnection
    ? { cwd: activeCwd, ...(connectionId ? { connectionId } : {}) } : null, [activeCwd, !!focusedSpec, unavailableConnection, connectionId]);
  const recent = useGitContextStore(state => state.recent);
  const rememberedKey = useGitContextStore(state => state.sourceKey);
  const current = activeTab?.kind === 'git-diff' ? activeTab.selection
    : activeTab?.kind === 'editor' ? { target: { cwd: parentOf(activeTab.selected.path) ?? activeTab.selected.path, connectionId: activeTab.selected.connectionId }, paneId: activeTab.id }
      : target ? { target, paneId: focusedPaneId } : null;
  const sourceKey = current ? JSON.stringify([current.paneId, current.target.cwd, current.target.connectionId]) : '';
  useEffect(() => {
    if (current) useGitContextStore.getState().remember(sourceKey, current);
  }, [sourceKey]);
  const resolved = activeTab?.kind === 'session' && !current ? null : current && sourceKey !== rememberedKey ? current : recent;
  return { target: resolved?.target ?? null, paneId: resolved?.paneId ?? focusedPaneId,
    sourceKey: sourceKey || rememberedKey, unavailableConnection: !!unavailableConnection && !resolved };
}
