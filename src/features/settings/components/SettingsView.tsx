import {
  ChevronRight,
  Cpu,
  FileCode,
  Keyboard,
  Palette,
  Search,
  Settings,
  SquareTerminal,
} from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import Segmented from '@/components/ui/Segmented/Segmented';
import { useToastStore } from '@/components/ui/Toast/Toast';
import {
  clearSessionGrants,
  TOOL_NAMES,
  type ToolLevel,
  type ToolName,
  usePermissions,
} from '@/features/agent/services/permissions';
import { type FileOpenConfig, loadConfig, saveConfig } from '@/features/files/services/fileOpen';
import {
  AgentsSettings,
  MemorySettings,
  SchedulesSettings,
} from '@/features/settings/components/AgentExtrasSettings';
import { AiBehaviorPage } from '@/features/settings/components/aiBehaviorPage';
import { AiModelPage } from '@/features/settings/components/aiModelPage';
import { McpPage } from '@/features/settings/components/mcpPage';
import SkillsSettings from '@/features/settings/components/SkillsSettings';
import { ShortcutPage } from '@/features/settings/components/shortcutPage';
import { TerminalOpenPage } from '@/features/settings/components/terminalOpenPage';
import { ThemePage } from '@/features/settings/components/themePage';
import { btnStyle, Field, inputStyle, TemplateListEditor } from '@/features/settings/ui';
import {
  clearTavilyKey,
  refreshAiConfig,
  setTavilyKey,
  useAiConfigStore,
} from '@/services/tauri/ai';

/** 权限页工具中文名（与 messageParts 的 TOOL_LABEL 保持同步） */
const PERM_TOOL_LABEL: Record<ToolName, string> = {
  run_command: '执行终端命令',
  read_file: '读取文件',
  write_file: '写入文件',
  edit_file: '修改文件',
  list_dir: '列目录',
  search_files: '搜索文件',
  web_search: '联网搜索',
  web_fetch: '抓取网页',
  web_crawl: '爬取多个网页',
  read_terminal: '读取终端画面',
  terminal_keys: '向终端发送按键',
  use_skill: '调用技能',
  install_skill: '安装技能',
  mcp: 'MCP 服务器工具',
  memory: '写入记忆',
  schedule: '管理定时任务',
  subagent: '委派子代理',
};

// ── 设置页结构 ──
// 外层 = 按功能划分的组（大菜单，可展开）；内层 = 细分设置页（小菜单）。
// 每个设置页内再放多个相关的具体配置项。

type PageId =
  | 'ai-model'
  | 'ai-behavior'
  | 'ai-perms'
  | 'ai-web'
  | 'ai-skill'
  | 'ai-mcp'
  | 'ai-memory'
  | 'ai-agents'
  | 'ai-schedules'
  | 'terminal-open'
  | 'editor-local'
  | 'editor-remote'
  | 'appearance-theme'
  | 'shortcuts';

interface SettingItem {
  id: PageId;
  label: string;
  keywords: string[];
}
interface SettingGroup {
  id: string;
  label: string;
  icon: typeof Settings;
  items: SettingItem[];
}

const GROUPS: SettingGroup[] = [
  {
    id: 'ai',
    label: 'AI 模型',
    icon: Cpu,
    items: [
      {
        id: 'ai-model',
        label: '模型配置',
        keywords: [
          'ai',
          'model',
          'api',
          'key',
          'baseurl',
          '模型',
          '密钥',
          '服务地址',
          'provider',
          '服务商',
          'anthropic',
          'gemini',
        ],
      },
      {
        id: 'ai-behavior',
        label: '模型行为',
        keywords: [
          'agent',
          '联网',
          '深思考',
          '思考',
          '智能标题',
          '标题',
          '自动补全',
          '补全',
          '防抖',
          'debounce',
        ],
      },
      {
        id: 'ai-perms',
        label: '模型权限',
        keywords: ['权限', '审批', 'permission', '工具', '许可', '授权', '危险命令'],
      },
      {
        id: 'ai-web',
        label: '网络搜索',
        keywords: ['tavily', '联网', '搜索', 'web', 'search', 'grounding'],
      },
      {
        id: 'ai-skill',
        label: '技能',
        keywords: ['技能', 'skill', '能力', '提示词', 'prompt', '自定义', '代理'],
      },
      {
        id: 'ai-mcp',
        label: 'MCP 服务器',
        keywords: ['mcp', '工具', '服务器', 'server', 'stdio', '协议', '外部工具'],
      },
      { id: 'ai-memory', label: '记忆', keywords: ['记忆', 'memory', '长期', '偏好', '约定'] },
      {
        id: 'ai-agents',
        label: '子代理',
        keywords: ['子代理', 'agent', '多agent', '委派', 'subagent'],
      },
      {
        id: 'ai-schedules',
        label: '定时任务',
        keywords: ['定时', '任务', 'schedule', 'cron', '自动'],
      },
    ],
  },
  {
    id: 'terminal',
    label: '终端',
    icon: SquareTerminal,
    items: [
      {
        id: 'terminal-open',
        label: '打开方式',
        keywords: ['终端', '打开', '模式', '经典', '块', 'block', 'classic', 'terminal'],
      },
    ],
  },
  {
    id: 'editor',
    label: '编辑器',
    icon: FileCode,
    items: [
      {
        id: 'editor-local',
        label: '本地编辑器',
        keywords: ['编辑器', 'editor', 'vim', '本地', '扩展名', '模板'],
      },
      {
        id: 'editor-remote',
        label: '远程编辑器',
        keywords: ['远程', 'remote', 'ssh', '编辑器', '扩展名', '模板'],
      },
    ],
  },
  {
    id: 'appearance',
    label: '外观',
    icon: Palette,
    items: [
      {
        id: 'appearance-theme',
        label: '主题',
        keywords: ['主题', 'theme', '深色', '浅色', '暗色'],
      },
    ],
  },
  {
    id: 'shortcuts',
    label: '快捷键',
    icon: Keyboard,
    items: [
      {
        id: 'shortcuts',
        label: '快捷键说明',
        keywords: ['快捷键', 'shortcut', 'key', '键位', '分屏', '搜索'],
      },
    ],
  },
];

/**
 * SettingsView — 设置标签页内容（与「会话历史」同级，作为一个会话看待）。
 * 左侧分级侧栏（组可展开 + 搜索过滤），右侧为当前设置页（页内含多个相关配置）。
 */
export default function SettingsView() {
  const [selected, setSelected] = useState<PageId>('ai-model');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(GROUPS.map((g) => g.id)));
  const [query, setQuery] = useState('');

  // 文件打开配置（localStorage）
  const [fileCfg, setFileCfg] = useState<FileOpenConfig>(() => loadConfig());
  const updateFileCfg = (patch: Partial<FileOpenConfig>) => {
    setFileCfg((prev) => {
      const next = { ...prev, ...patch };
      saveConfig(next);
      return next;
    });
  };

  // AI 配置（Rust 后端；store 镜像供响应式订阅，key 只写不回显）
  const aiCfg = useAiConfigStore();
  const [tavilyDraft, setTavilyDraft] = useState('');
  const toast = (msg: string, type: 'info' | 'success' | 'error') =>
    useToastStore.getState().addToast(msg, type);

  // AI 权限（M3）：持久化默认级别 + 内存会话授权
  const permLevels = usePermissions((s) => s.levels);
  const setPermLevel = usePermissions((s) => s.setLevel);

  useEffect(() => {
    refreshAiConfig();
  }, []);

  // 搜索过滤：命中项保留，自动展开其所在组
  const q = query.trim().toLowerCase();
  const visibleGroups = useMemo(() => {
    if (!q) return GROUPS;
    return GROUPS.map((g) => ({
      ...g,
      items: g.items.filter(
        (it) =>
          it.label.toLowerCase().includes(q) ||
          it.keywords.some((k) => k.toLowerCase().includes(q)),
      ),
    })).filter((g) => g.items.length > 0);
  }, [q]);

  const toggleGroup = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const activeLabel =
    GROUPS.flatMap((g) => g.items).find((it) => it.id === selected)?.label ?? '设置';

  const renderPage = (): ReactNode => {
    switch (selected) {
      case 'ai-model':
        return <AiModelPage />;

      case 'ai-behavior':
        return <AiBehaviorPage />;

      case 'ai-web': {
        const mode =
          aiCfg.provider !== 'openai-compatible'
            ? '服务商原生搜索'
            : aiCfg.hasTavilyKey
              ? 'Tavily'
              : 'DuckDuckGo 兜底';
        return (
          <>
            <Field title="当前搜索方式" description="搜索始终可用，无需配置。">
              <span
                style={{
                  fontSize: 11,
                  padding: '2px 8px',
                  borderRadius: 4,
                  color: 'var(--text-secondary)',
                  background: 'var(--hover)',
                }}
              >
                {mode}
              </span>
            </Field>
            <Field
              title="Tavily API Key"
              description="可选，配置后搜索质量更好，未配置时用 DuckDuckGo 兜底。"
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span
                  style={{
                    fontSize: 11,
                    padding: '2px 8px',
                    borderRadius: 4,
                    color: aiCfg.hasTavilyKey ? 'var(--success)' : 'var(--text-muted)',
                    background: aiCfg.hasTavilyKey ? 'var(--success-bg)' : 'var(--hover)',
                  }}
                >
                  {aiCfg.hasTavilyKey ? '已配置' : '未配置'}
                </span>
                {aiCfg.hasTavilyKey && (
                  <button
                    onClick={() =>
                      clearTavilyKey().then(() => toast('已清除 Tavily Key', 'success'))
                    }
                    style={btnStyle}
                  >
                    清除
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="password"
                  value={tavilyDraft}
                  placeholder={
                    aiCfg.hasTavilyKey ? '输入以覆盖，留空不改动' : '输入 Tavily API Key'
                  }
                  onChange={(e) => setTavilyDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitTavilyKey();
                  }}
                  style={inputStyle}
                />
                <button
                  onClick={commitTavilyKey}
                  style={{
                    ...btnStyle,
                    background: 'var(--accent)',
                    color: 'var(--accent-text)',
                    border: 'none',
                    flexShrink: 0,
                  }}
                >
                  保存
                </button>
              </div>
            </Field>
          </>
        );
      }

      case 'ai-perms':
        return (
          <>
            <Field
              title="工具权限"
              description="允许直接使用；每次询问会弹审批；禁止则不注册。危险命令始终逐次询问。"
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {TOOL_NAMES.map((name) => {
                  const lv: ToolLevel = permLevels[name] ?? 'ask';
                  return (
                    <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ flex: 1, fontSize: 12, color: 'var(--text-primary)' }}>
                        {PERM_TOOL_LABEL[name]}
                      </span>
                      <Segmented
                        size="sm"
                        options={(
                          [
                            ['allow', '允许'],
                            ['ask', '每次询问'],
                            ['deny', '禁止'],
                          ] as const
                        ).map(([v, label]) => ({ value: v, label }))}
                        value={lv}
                        onChange={(v) => setPermLevel(name, v)}
                      />
                    </div>
                  );
                })}
              </div>
            </Field>
            <Field
              title="会话授权"
              description="审批卡上点过「本会话允许」的工具会被记住，重启后自动失效；也可在此一键清空。"
            >
              <button
                style={btnStyle}
                onClick={() => {
                  clearSessionGrants();
                  toast('已清空全部会话授权', 'success');
                }}
              >
                清空会话授权
              </button>
            </Field>
          </>
        );

      case 'ai-skill':
        return <SkillsSettings />;

      case 'ai-mcp':
        return <McpPage />;

      case 'ai-memory':
        return <MemorySettings />;

      case 'ai-agents':
        return <AgentsSettings />;

      case 'ai-schedules':
        return <SchedulesSettings />;

      case 'terminal-open':
        return <TerminalOpenPage />;

      case 'editor-local':
        return (
          <>
            <Field
              title="默认编辑器"
              description="本地文件双击打开时使用的编辑器命令；缺失时自动降级 vim → nano → vi。"
            >
              <input
                value={fileCfg.defaultEditor}
                placeholder="vim"
                onChange={(e) => updateFileCfg({ defaultEditor: e.target.value })}
                style={inputStyle}
              />
            </Field>
            <Field
              title="按扩展名打开"
              description="为不同扩展名指定打开命令；{file} 为路径占位符，__system__ 表示用系统默认应用。"
            >
              <TemplateListEditor
                value={fileCfg.templates}
                onChange={(templates) => updateFileCfg({ templates })}
                placeholder="如 code、__system__"
              />
            </Field>
          </>
        );

      case 'editor-remote':
        return (
          <>
            <Field
              title="默认编辑器"
              description="远程文件双击打开时，在 SSH 终端里使用的编辑器命令。"
            >
              <input
                value={fileCfg.remoteEditor}
                placeholder="vim"
                onChange={(e) => updateFileCfg({ remoteEditor: e.target.value })}
                style={inputStyle}
              />
            </Field>
            <Field
              title="按扩展名打开"
              description="为远程不同扩展名指定打开命令；{file} 为路径占位符。"
            >
              <TemplateListEditor
                value={fileCfg.remoteTemplates}
                onChange={(remoteTemplates) => updateFileCfg({ remoteTemplates })}
                placeholder="如 nvim、less"
              />
            </Field>
          </>
        );

      case 'appearance-theme':
        return <ThemePage />;

      case 'shortcuts':
        return <ShortcutPage />;

      default:
        return null;
    }
  };

  function commitTavilyKey() {
    const k = tavilyDraft.trim();
    if (!k) return;
    setTavilyKey(k)
      .then(() => {
        setTavilyDraft('');
        toast('已保存 Tavily Key', 'success');
      })
      .catch((e) => toast(String((e as Error)?.message ?? e), 'error'));
  }

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'row',
        background: 'var(--surface)',
        userSelect: 'none',
      }}
    >
      {/* 侧栏 */}
      <aside
        style={{
          width: 216,
          flexShrink: 0,
          borderRight: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
        }}
      >
        <div style={{ padding: 8 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 8px',
              borderRadius: 'var(--radius-inner)',
              background: 'var(--canvas)',
            }}
          >
            <Search size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索设置…"
              style={{
                flex: 1,
                minWidth: 0,
                background: 'transparent',
                border: 'none',
                outline: 'none',
                fontSize: 12,
                color: 'var(--text-primary)',
              }}
            />
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 6px 8px' }}>
          {visibleGroups.map((g) => {
            const Icon = g.icon;
            const open = q ? true : expanded.has(g.id);
            return (
              <div key={g.id} style={{ marginBottom: 2 }}>
                <button
                  onClick={() => toggleGroup(g.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    width: '100%',
                    padding: '6px 8px',
                    fontSize: 12,
                    fontWeight: 600,
                    background: 'transparent',
                    border: 'none',
                    borderRadius: 5,
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                  }}
                >
                  <ChevronRight
                    size={12}
                    style={{
                      color: 'var(--text-muted)',
                      transition: 'transform 0.12s ease',
                      transform: open ? 'rotate(90deg)' : 'none',
                    }}
                  />
                  <Icon size={13} style={{ color: 'var(--text-muted)' }} />
                  {g.label}
                </button>
                {open &&
                  g.items.map((it) => (
                    <button
                      key={it.id}
                      onClick={() => setSelected(it.id)}
                      style={{
                        display: 'block',
                        width: '100%',
                        textAlign: 'left',
                        padding: '5px 8px 5px 32px',
                        fontSize: 12,
                        background: selected === it.id ? 'var(--hover)' : 'transparent',
                        border: 'none',
                        borderRadius: 5,
                        cursor: 'pointer',
                        color: selected === it.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                      }}
                    >
                      {it.label}
                    </button>
                  ))}
              </div>
            );
          })}
          {visibleGroups.length === 0 && (
            <div
              style={{ padding: 16, textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}
            >
              无匹配设置
            </div>
          )}
        </div>
      </aside>

      {/* 内容区 */}
      <section style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '18px 22px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 18,
            paddingBottom: 12,
            borderBottom: '1px solid var(--border)',
          }}
        >
          <Settings size={15} style={{ color: 'var(--text-muted)' }} />
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
            {activeLabel}
          </span>
        </div>
        <div style={{ maxWidth: 560 }}>{renderPage()}</div>
      </section>
    </div>
  );
}
