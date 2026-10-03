import { useEffect, useState, type ReactNode } from 'react';
import { Search, ChevronRight, Settings } from 'lucide-react';
import { loadConfig, saveConfig, type FileOpenConfig } from '@features/files/services/fileOpen';
import { refreshAiConfig, setTavilyKey, clearTavilyKey, useAiConfigStore } from '@features/agent';
import SkillsSettings from '@features/settings/pages/SkillsSettings';
import { MemorySettings, AgentsSettings, SchedulesSettings } from '@features/settings/pages/AgentExtrasSettings';
import Segmented from '@ui/Segmented';
import { useToastStore } from '@ui/Toast';
import {
  usePermissions, clearSessionGrants, TOOL_NAMES,
  type ToolLevel, type ToolName,
} from '@features/agent';
import { Field, TemplateListEditor, inputStyle, btnStyle } from '@features/settings/components/ui';
import { AiModelPage } from '@features/settings/pages/aiModelPage';
import { AiBehaviorPage } from '@features/settings/pages/aiBehaviorPage';
import { McpPage } from '@features/settings/pages/mcpPage';
import { TerminalOpenPage } from '@features/settings/pages/terminalOpenPage';
import { ThemePage } from '@features/settings/pages/themePage';
import { ShortcutPage } from '@features/settings/pages/shortcutPage';
import { useSettingsNavigation } from '@features/settings/hooks/useSettingsNavigation';

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

/**
 * SettingsView — 设置标签页内容（与「会话历史」同级，作为一个会话看待）。
 * 左侧分级侧栏（组可展开 + 搜索过滤），右侧为当前设置页（页内含多个相关配置）。
 */
export default function SettingsView() {
  const {
    selected,
    setSelected,
    expanded,
    query,
    setQuery,
    normalizedQuery,
    visibleGroups,
    activeLabel,
    toggleGroup,
  } = useSettingsNavigation();

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
              <span style={{
                fontSize: 11, padding: '2px 8px', borderRadius: 4,
                color: 'var(--text-secondary)', background: 'var(--hover)',
              }}>
                {mode}
              </span>
            </Field>
            <Field title="Tavily API Key" description="可选，配置后搜索质量更好，未配置时用 DuckDuckGo 兜底。">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{
                  fontSize: 11, padding: '2px 8px', borderRadius: 4,
                  color: aiCfg.hasTavilyKey ? 'var(--success)' : 'var(--text-muted)',
                  background: aiCfg.hasTavilyKey ? 'var(--success-bg)' : 'var(--hover)',
                }}>
                  {aiCfg.hasTavilyKey ? '已配置' : '未配置'}
                </span>
                {aiCfg.hasTavilyKey && (
                  <button
                    onClick={() => clearTavilyKey().then(() => toast('已清除 Tavily Key', 'success'))}
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
                  placeholder={aiCfg.hasTavilyKey ? '输入以覆盖，留空不改动' : '输入 Tavily API Key'}
                  onChange={(e) => setTavilyDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') commitTavilyKey(); }}
                  style={inputStyle}
                />
                <button
                  onClick={commitTavilyKey}
                  style={{ ...btnStyle, background: 'var(--accent)', color: 'var(--accent-text)', border: 'none', flexShrink: 0 }}
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
            <Field title="默认编辑器" description="本地文件双击打开时使用的编辑器命令；缺失时自动降级 vim → nano → vi。">
              <input
                value={fileCfg.defaultEditor}
                placeholder="vim"
                onChange={(e) => updateFileCfg({ defaultEditor: e.target.value })}
                style={inputStyle}
              />
            </Field>
            <Field title="按扩展名打开" description="为不同扩展名指定打开命令；{file} 为路径占位符，__system__ 表示用系统默认应用。">
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
            <Field title="默认编辑器" description="远程文件双击打开时，在 SSH 终端里使用的编辑器命令。">
              <input
                value={fileCfg.remoteEditor}
                placeholder="vim"
                onChange={(e) => updateFileCfg({ remoteEditor: e.target.value })}
                style={inputStyle}
              />
            </Field>
            <Field title="按扩展名打开" description="为远程不同扩展名指定打开命令；{file} 为路径占位符。">
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
      .then(() => { setTavilyDraft(''); toast('已保存 Tavily Key', 'success'); })
      .catch((e) => toast(String((e as Error)?.message ?? e), 'error'));
  }

  return (
    <div className="settings-view" style={{
      flex: 1, minHeight: 0, display: 'flex', flexDirection: 'row',
      background: 'var(--canvas)', userSelect: 'none',
    }}>
      {/* 侧栏 */}
      <aside className="settings-navigation" style={{
        width: 192, flexShrink: 0, background: 'var(--surface)',
        display: 'flex', flexDirection: 'column', minHeight: 0,
      }}>
        <div style={{ padding: 8 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '4px 8px',
            borderRadius: 'var(--radius-inner)', background: 'var(--block)',
          }}>
            <Search size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索设置…"
              style={{
                flex: 1, minWidth: 0, background: 'transparent', border: 'none',
                outline: 'none', fontSize: 12, color: 'var(--text-primary)',
              }}
            />
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 6px 8px' }}>
          {visibleGroups.map((g) => {
            const Icon = g.icon;
            const open = normalizedQuery ? true : expanded.has(g.id);
            return (
              <div key={g.id} style={{ marginBottom: 2 }}>
                <button
                  onClick={() => toggleGroup(g.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, width: '100%',
                    padding: '6px 8px', fontSize: 12, fontWeight: 600,
                    background: 'transparent', border: 'none', borderRadius: 5,
                    color: 'var(--text-primary)', cursor: 'pointer',
                  }}
                >
                  <ChevronRight
                    size={12}
                    style={{ color: 'var(--text-muted)', transition: 'transform 0.12s ease', transform: open ? 'rotate(90deg)' : 'none' }}
                  />
                  <Icon size={13} style={{ color: 'var(--text-muted)' }} />
                  {g.label}
                </button>
                {open && g.items.map((it) => (
                  <button
                    key={it.id}
                    onClick={() => setSelected(it.id)}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      padding: '5px 8px 5px 32px', fontSize: 12,
                      background: selected === it.id ? 'var(--selection-bg)' : 'transparent',
                      border: 'none', borderRadius: 5, cursor: 'pointer',
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
            <div style={{ padding: 16, textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
              无匹配设置
            </div>
          )}
        </div>
      </aside>

      {/* 内容区 */}
      <section className="settings-content" style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '22px 26px', background: 'var(--canvas)' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          marginBottom: 24,
        }}>
          <Settings size={15} style={{ color: 'var(--text-muted)' }} />
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{activeLabel}</span>
        </div>
        <div style={{ maxWidth: 560 }}>{renderPage()}</div>
      </section>
    </div>
  );
}

