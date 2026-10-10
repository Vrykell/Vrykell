import { searchSettings } from '../services/registry';
import { useMemo, useState } from 'react';
import { BrainCircuit, FileCode, Keyboard, Settings, SquareTerminal, History, FileText, ShieldCheck, Globe, Folder, Plug, Bot, RefreshCw, Sun } from '@ui/icons';
import type { PageId } from '../model/navigation';
import { useSettingsNavigationStore } from '../stores/navigation';
export type { PageId } from '../model/navigation';

export interface SettingItem {
  id: PageId;
  label: string;
  keywords: string[];
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
      { id: 'startup', icon: History, label: '启动', keywords: ['启动', '标签页', '恢复', '会话记录', '默认', 'startup'] },
      { id: 'logs', icon: FileText, label: '日志与诊断', keywords: ['日志', '诊断', '导出', '自动保存', '错误', 'log', 'debug'] },
    ],
  },
  {
    id: 'ai', label: 'AI 模型',
    items: [
      { id: 'ai-model', icon: BrainCircuit, label: '模型配置', keywords: ['ai', 'model', 'api', 'key', 'baseurl', '模型', '密钥', '服务地址', 'provider', '服务商', 'anthropic', 'gemini'] },
      { id: 'ai-behavior', icon: Settings, label: '模型行为', keywords: ['agent', '联网', '深思考', '思考', '智能标题', '标题', '自动补全', '补全', '防抖', 'debounce'] },
      { id: 'ai-perms', icon: ShieldCheck, label: '模型权限', keywords: ['权限', '审批', 'permission', '工具', '许可', '授权', '危险命令'] },
      { id: 'ai-web', icon: Globe, label: '网络搜索', keywords: ['tavily', '联网', '搜索', 'web', 'search', 'grounding'] },
      { id: 'ai-skill', icon: Folder, label: '技能', keywords: ['技能', 'skill', '能力', '提示词', 'prompt', '自定义', '代理'] },
      { id: 'ai-mcp', icon: Plug, label: 'MCP 服务器', keywords: ['mcp', '工具', '服务器', 'server', 'stdio', '协议', '外部工具'] },
      { id: 'ai-memory', icon: FileText, label: '记忆', keywords: ['记忆', 'memory', '长期', '偏好', '约定'] },
      { id: 'ai-agents', icon: Bot, label: '子代理', keywords: ['子代理', 'agent', '多agent', '委派', 'subagent'] },
      { id: 'ai-schedules', icon: RefreshCw, label: '定时任务', keywords: ['定时', '任务', 'schedule', 'cron', '自动'] },
    ],
  },
  {
    id: 'terminal', label: '终端',
    items: [{ id: 'terminal-open', icon: SquareTerminal, label: '打开方式', keywords: ['终端', '打开', '模式', '经典', '块', 'block', 'classic', 'terminal', '默认', 'shell', 'default'] }],
  },
  {
    id: 'editor', label: '编辑器',
    items: [
      { id: 'editor-local', icon: FileCode, label: '本地编辑器', keywords: ['编辑器', 'editor', 'vim', '本地', '扩展名', '模板'] },
      { id: 'editor-remote', icon: FileCode, label: '远程编辑器', keywords: ['远程', 'remote', 'ssh', '编辑器', '扩展名', '模板'] },
    ],
  },
  {
    id: 'appearance', label: '外观',
    items: [{ id: 'appearance-theme', icon: Sun, label: '主题', keywords: ['主题', 'theme', '深色', '浅色', '暗色'] }],
  },
  {
    id: 'shortcuts', label: '快捷键',
    items: [{ id: 'shortcuts', icon: Keyboard, label: '快捷键说明', keywords: ['快捷键', 'shortcut', 'key', '键位', '分屏', '搜索'] }],
  },
];

/** Filter the settings index while keeping every navigation group visible. */
export function useSettingsNavigation() {
  const selected = useSettingsNavigationStore(state => state.selected);
  const setSelected = useSettingsNavigationStore(state => state.setSelected);
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLowerCase();

  const matchingSettings = useMemo(() => normalizedQuery ? searchSettings(query) : [], [normalizedQuery, query]);

  const visibleGroups = useMemo(() => {
    if (!normalizedQuery) return SETTINGS_GROUPS;
    return SETTINGS_GROUPS.map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        item.label.toLowerCase().includes(normalizedQuery)
        || item.keywords.some((keyword) => keyword.toLowerCase().includes(normalizedQuery)),
      ),
    })).filter((group) => group.items.length > 0);
  }, [normalizedQuery]);

  const activeLabel = SETTINGS_GROUPS.flatMap((group) => group.items).find((item) => item.id === selected)?.label ?? '设置';

  return {
    selected,
    setSelected,
    query,
    setQuery,
    normalizedQuery,
    visibleGroups,
    matchingSettings,
    activeLabel,
  };
}
