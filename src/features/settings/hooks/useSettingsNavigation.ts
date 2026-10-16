import { BrainCircuit, FileCode, Keyboard, Settings, SquareTerminal, History, FileText, ShieldCheck, Globe, Folder, Plug, Bot, RefreshCw, Sun } from '@ui/icons';
import type { PageId } from '../model/navigation';
import { t } from '@i18n';
import { useSettingsNavigationStore } from '../stores/navigation';
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
    id: 'application', label: '应用',
    items: [
      { id: 'startup', icon: History, label: '启动' },
      { id: 'logs', icon: FileText, label: '日志与诊断' },
      { id: 'context-menu', icon: Folder, label: t('Windows context menu') },
    ],
  },
  {
    id: 'ai', label: 'AI 模型',
    items: [
      { id: 'ai-model', icon: BrainCircuit, label: '模型配置' },
      { id: 'ai-behavior', icon: Settings, label: '模型行为' },
      { id: 'ai-perms', icon: ShieldCheck, label: '模型权限' },
      { id: 'ai-web', icon: Globe, label: '网络搜索' },
      { id: 'ai-skill', icon: Folder, label: '技能' },
      { id: 'ai-mcp', icon: Plug, label: 'MCP 服务器' },
      { id: 'ai-memory', icon: FileText, label: '记忆' },
      { id: 'ai-agents', icon: Bot, label: '子代理' },
      { id: 'ai-schedules', icon: RefreshCw, label: '定时任务' },
      { id: 'ai-harness', icon: Bot, label: t('External harnesses') },
    ],
  },
  {
    id: 'terminal', label: '终端',
    items: [{ id: 'terminal-open', icon: SquareTerminal, label: '打开方式' }],
  },
  {
    id: 'editor', label: '编辑器',
    items: [
      { id: 'editor-local', icon: FileCode, label: '本地编辑器' },
      { id: 'editor-remote', icon: FileCode, label: '远程编辑器' },
    ],
  },
  {
    id: 'appearance', label: '外观',
    items: [{ id: 'appearance-theme', icon: Sun, label: '主题' }],
  },
  {
    id: 'shortcuts', label: '快捷键',
    items: [{ id: 'shortcuts', icon: Keyboard, label: '快捷键说明' }],
  },
];

/** Keep the active settings page in sync with external navigation. */
export function useSettingsNavigation() {
  const selected = useSettingsNavigationStore(state => state.selected);
  const setSelected = useSettingsNavigationStore(state => state.setSelected);
  const activeLabel = SETTINGS_GROUPS.flatMap(group => group.items).find(item => item.id === selected)?.label ?? t('Settings');
  return { selected, setSelected, activeLabel, groups: SETTINGS_GROUPS };
}
