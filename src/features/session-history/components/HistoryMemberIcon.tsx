import { Bot } from '@ui/icons';
import AppMark from '@ui/icons/AppMark';
import { TerminalProfileIcon } from '@ui/icons/shellIcons';
import { harnessMark } from '@features/agent/components/HarnessBadge';
import { fileIcon } from '@features/files';
import type { WorkspaceHistoryMember } from '@features/workspace/model/workspaceHistory';

export default function HistoryMemberIcon({ member, size = 16 }: { member: WorkspaceHistoryMember; size?: number }) {
  if (member.kind === 'conversation') return <AppMark size={size} />;
  if (member.kind === 'terminal') return <TerminalProfileIcon kind={member.ssh ? 'ssh' : 'local'} shellType={member.shellType} connectionId={member.connectionId} size={size} />;
  const Mark = member.kind === 'agent' ? harnessMark(member.reference, Bot) : fileIcon(member.title);
  return <Mark size={size} />;
}
