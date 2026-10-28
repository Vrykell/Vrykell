import type { WorkspaceScope } from './workbench';
import { t } from '@i18n';
import type { ContextMenuItem } from '@ui/menus/ContextMenu';

export type WorkspaceCreation = 'terminal' | 'ssh' | 'document' | 'file' | 'conversation' | 'agent';
const choices: Record<WorkspaceScope, WorkspaceCreation[]> = {
  terminal: ['terminal', 'ssh'], code: ['document', 'file'], ai: ['conversation', 'agent'],
  unified: ['terminal', 'ssh', 'conversation', 'document', 'file', 'agent'],
};
const labels: Record<WorkspaceCreation, string> = {
  terminal: 'New terminal', ssh: 'Connect a server', document: 'New file', file: 'Open file', conversation: 'New conversation', agent: 'ACP agents',
};

/** Every split entry exposes resource types before opening their existing creation flow. */
export function workspaceSplitMenu(scope: WorkspaceScope, pick: (kind: WorkspaceCreation) => void): ContextMenuItem {
  return { label: t('Split tab'), submenu: { items: choices[scope].map(kind => ({ label: t(labels[kind]), onClick: () => pick(kind) })) } };
}
