import { useCallback, useMemo, useState } from 'react';
import { Cpu, FileCode, Keyboard, Palette, Settings, SquareTerminal } from 'lucide-react';

export type PageId = 'ai-model' | 'ai-behavior' | 'ai-perms' | 'ai-web' | 'ai-skill' | 'ai-mcp' | 'ai-memory' | 'ai-agents' | 'ai-schedules' | 'terminal-open' | 'editor-local' | 'editor-remote' | 'appearance-theme' | 'shortcuts';

export interface SettingItem {
  id: PageId;
  label: string;
  keywords: string[];
}

export interface SettingGroup {
  id: string;
  label: string;
  icon: typeof Settings;
  items: SettingItem[];
}

export const SETTINGS_GROUPS: SettingGroup[] = [
  {
    id: 'ai', label: 'AI 模型', icon: Cpu,
    items: [
      { id: 'ai-model', label: '模型配置', keywords: ['ai', 'model', 'api', 'key', 'baseurl', '模型', '密钥', '服务地址', 'provider', '服务商', 'anthropic', 'gemini'] },
      { id: 'ai-behavior', label: '模型行为', keywords: ['agent', '联网', '深思考', '思考', '智能标题', '标题', '自动补全', '补全', '防抖', 'debounce'] },
      { id: 'ai-perms', label: '模型权限', keywords: ['权限', '审批', 'permission', '工具', '许可', '授权', '危险命令'] },
      { id: 'ai-web', label: '网络搜索', keywords: ['tavily', '联网', '搜索', 'web', 'search', 'grounding'] },
      { id: 'ai-skill', label: '技能', keywords: ['技能', 'skill', '能力', '提示词', 'prompt', '自定义', '代理'] },
      { id: 'ai-mcp', label: 'MCP 服务器', keywords: ['mcp', '工具', '服务器', 'server', 'stdio', '协议', '外部工具'] },
      { id: 'ai-memory', label: '记忆', keywords: ['记忆', 'memory', '长期', '偏好', '约定'] },
      { id: 'ai-agents', label: '子代理', keywords: ['子代理', 'agent', '多agent', '委派', 'subagent'] },
      { id: 'ai-schedules', label: '定时任务', keywords: ['定时', '任务', 'schedule', 'cron', '自动'] },
    ],
  },
  {
    id: 'terminal', label: '终端', icon: SquareTerminal,
    items: [{ id: 'terminal-open', label: '打开方式', keywords: ['终端', '打开', '模式', '经典', '块', 'block', 'classic', 'terminal'] }],
  },
  {
    id: 'editor', label: '编辑器', icon: FileCode,
    items: [
      { id: 'editor-local', label: '本地编辑器', keywords: ['编辑器', 'editor', 'vim', '本地', '扩展名', '模板'] },
      { id: 'editor-remote', label: '远程编辑器', keywords: ['远程', 'remote', 'ssh', '编辑器', '扩展名', '模板'] },
    ],
  },
  {
    id: 'appearance', label: '外观', icon: Palette,
    items: [{ id: 'appearance-theme', label: '主题', keywords: ['主题', 'theme', '深色', '浅色', '暗色'] }],
  },
  {
    id: 'shortcuts', label: '快捷键', icon: Keyboard,
    items: [{ id: 'shortcuts', label: '快捷键说明', keywords: ['快捷键', 'shortcut', 'key', '键位', '分屏', '搜索'] }],
  },
];

/** 管理设置页搜索、分组折叠和当前页选择。 */
export function useSettingsNavigation() {
  const [selected, setSelected] = useState<PageId>('ai-model');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(SETTINGS_GROUPS.map((group) => group.id)));
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLowerCase();

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

  const toggleGroup = useCallback((id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const activeLabel = SETTINGS_GROUPS.flatMap((group) => group.items).find((item) => item.id === selected)?.label ?? '设置';

  return {
    selected,
    setSelected,
    expanded,
    query,
    setQuery,
    normalizedQuery,
    visibleGroups,
    activeLabel,
    toggleGroup,
  };
}
