import { Bot, History } from '@ui/icons';
import AppMark from '@ui/icons/AppMark';
import { TerminalProfileIcon } from '@ui/icons/shellIcons';
import { harnessMark } from '@features/agent/components/HarnessBadge';
import { fileIcon } from '@features/files';
import { useWorkspaceStore } from '../stores/workspace';
import { firstLeaf, leaves } from '../model/windowLayout';
import type { WorkspaceResource } from '../model/workspaceResources';

export default function WorkspaceResourceIcon({ resource, size = 16, defaultShellType }: { resource: WorkspaceResource; size?: number; defaultShellType?: string }) {
  const tab = useWorkspaceStore(state => resource.kind === 'terminal' ? state.tabs.find(tab => tab.id === resource.tabId) : undefined);
  if (resource.kind === 'conversation') return <AppMark size={size} />;
  if (resource.kind === 'agent') { const Mark = harnessMark(resource.title, Bot); return <Mark size={size} />; }
  if (resource.kind === 'terminal') {
    const terminal = tab?.kind === 'session' ? leaves(tab.layout).find(terminal => terminal.id === resource.paneId) ?? firstLeaf(tab.layout) : undefined;
    return <TerminalProfileIcon kind={terminal?.kind} shellType={terminal?.shellType ?? defaultShellType} connectionId={terminal?.ssh?.connectionId} size={size} />;
  }
  if (resource.kind === 'page') return <History size={size} />;
  const Icon = fileIcon(resource.title); return <Icon size={size} />;
}
