import type { TerminalSpec } from '../model/windowLayout';
import { firstLeaf } from '../model/windowLayout';
import { useWorkspaceStore } from '../stores/workspace';
import { useWorkspaceNavigation } from '../stores/navigation';
import type { ShellType } from '@platform/shells';

export function createExecutionTerminal(spec: TerminalSpec) {
  const workspace = useWorkspaceStore.getState();
  const { area, aiPlacement } = useWorkspaceNavigation.getState();
  const previous = workspace.activeId;
  const id = workspace.addTab({ kind: spec.kind, ssh: spec.ssh, shellType: spec.shellType as ShellType | undefined, cwd: spec.cwd, useProfileDirectory: spec.useProfileDirectory });
  const tab = useWorkspaceStore.getState().tabs.find(tab => tab.id === id);
  if ((area === 'ai' || area === 'unified') && useWorkspaceStore.getState().tabs.some(tab => tab.id === previous)) workspace.activate(previous);
  useWorkspaceNavigation.getState().selectArea(area);
  useWorkspaceNavigation.getState().setAiPlacement(aiPlacement);
  return tab?.kind === 'session' ? firstLeaf(tab.layout).id : undefined;
}
