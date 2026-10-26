import { BrainCircuit, FileCode, Keyboard, Settings, SquareTerminal, History, FileText, ShieldCheck, Globe, Folder, Plug, Bot, Sun, Palette, TextFont } from '@ui/icons';
import type { PageId } from '../model/navigation';
import { isSettingsPageAvailable } from '../model/navigation';
import { t } from '@i18n';
import { useSettingsNavigationStore } from '../stores/navigation';
import { SHELL_TYPES, shellTypeLabel } from '@platform/shells';
import { shellIconFor } from '@ui/icons/shellIcons';
export type { PageId } from '../model/navigation';

export interface SettingItem {
  id: PageId;
  label: string;
  icon: typeof Settings;
}

export interface SettingGroup {
  id: string;
  label: string;
  items: SettingItem[];
}

export const SETTINGS_GROUPS: SettingGroup[] = [
  {
    id: 'application', label: 'Application',
    items: [
      { id: 'application-language', icon: Globe, label: 'Language' },
      { id: 'startup', icon: History, label: 'Startup' },
      { id: 'logs', icon: FileText, label: 'Logs and diagnostics' },
      { id: 'file-operations', icon: Folder, label: 'File operations' },
      { id: 'context-menu', icon: Folder, label: 'Windows context menu' },
    ],
  },
  {
    id: 'ai', label: 'AI models',
    items: [
      { id: 'ai-model', icon: BrainCircuit, label: 'Model configuration' },
      { id: 'ai-behavior', icon: Settings, label: 'Model behavior' },
      { id: 'ai-perms', icon: ShieldCheck, label: 'Tool permissions' },
      { id: 'ai-web', icon: Globe, label: 'Web search' },
      { id: 'ai-skill', icon: Folder, label: 'Skills' },
      { id: 'ai-mcp', icon: Plug, label: 'MCP servers' },
      { id: 'ai-memory', icon: FileText, label: 'Agent memory' },
      { id: 'ai-harness', icon: Bot, label: 'ACP' },
    ],
  },
  {
    id: 'terminal', label: 'Terminal',
    items: [{ id: 'command-history', icon: SquareTerminal, label: 'Command history' }],
  },
  { id: 'profiles', label: 'Shell profiles', items: SHELL_TYPES.map(shell => ({ id: `profile:${shell}` as const, icon: shellIconFor(shell), label: shellTypeLabel(shell) })) },
  {
    id: 'editor', label: 'Editor',
    items: [
      { id: 'editor-preferences', icon: FileCode, label: 'Editor preferences' },
      { id: 'editor-local', icon: FileCode, label: 'Local file opening' },
      { id: 'editor-remote', icon: FileCode, label: 'Remote file opening' },
    ],
  },
  {
    id: 'appearance', label: 'Appearance',
    items: [
      { id: 'appearance-theme', icon: Sun, label: 'Theme' },
      { id: 'appearance-blocks', icon: Palette, label: 'Block appearance' },
      { id: 'appearance-typography', icon: TextFont, label: 'Typography' },
      { id: 'appearance-files', icon: FileText, label: 'Theme files' },
    ],
  },
  {
    id: 'shortcuts', label: 'Shortcuts',
    items: [{ id: 'shortcuts', icon: Keyboard, label: 'Keyboard shortcuts' }],
  },
];

/** Keep the active settings page in sync with external navigation. */
export function useSettingsNavigation() {
  const selected = useSettingsNavigationStore(state => isSettingsPageAvailable(state.selected) ? state.selected : 'application-language');
  const setSelected = useSettingsNavigationStore(state => state.setSelected);
  const groups = SETTINGS_GROUPS.map(group => ({ ...group, label: t(group.label), items: group.items.filter(item => isSettingsPageAvailable(item.id)).map(item => ({ ...item, label: t(item.label) })) }));
  const activeLabel = groups.flatMap(group => group.items).find(item => item.id === selected)?.label ?? t('Settings');
  return { selected, setSelected, activeLabel, groups };
}
