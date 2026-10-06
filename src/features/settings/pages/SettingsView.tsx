import { useEffect, useState, type ReactNode } from 'react';
import { iconSizes, Search, ChevronRight, Settings  } from '@ui/icons';
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
import { Field, TemplateListEditor, btnStyle } from '@features/settings/components/ui';
import { AiModelPage } from '@features/settings/pages/aiModelPage';
import { AiBehaviorPage } from '@features/settings/pages/aiBehaviorPage';
import { McpPage } from '@features/settings/pages/mcpPage';
import { TerminalOpenPage } from '@features/settings/pages/terminalOpenPage';
import { ThemePage } from '@features/settings/pages/themePage';
import { ShortcutPage } from '@features/settings/pages/shortcutPage';
import { useSettingsNavigation } from '@features/settings/hooks/useSettingsNavigation';
import AutoSaveInput from '../components/AutoSaveInput';
import SaveStatus from '../components/SaveStatus';
import { SettingsSaveProvider, useSettingsSave } from '../components/SettingsSaveProvider';
import { StartupPage } from './startupPage';
import { LogsPage } from './logsPage';

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
  return <SettingsSaveProvider><SettingsContent /></SettingsSaveProvider>;
}

function SettingsContent() {
  const { save, status, retry } = useSettingsSave();
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
    const next = { ...loadConfig(), ...patch };
    if (!saveConfig(next)) throw new Error('配置写入失败');
    setFileCfg(next);
  };

  // AI 配置（Rust 后端；store 镜像供响应式订阅，key 只写不回显）
  const aiCfg = useAiConfigStore();
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
      case 'startup': return <StartupPage />;
      case 'logs': return <LogsPage />;
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
                fontSize: 'calc(11px * var(--ui-font-scale))', padding: '2px 8px', borderRadius: 4,
                color: 'var(--text-secondary)', background: 'var(--hover)',
              }}>
                {mode}
              </span>
            </Field>
            <Field title="Tavily API Key" description="可选，配置后搜索质量更好，未配置时用 DuckDuckGo 兜底。">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{
                  fontSize: 'calc(11px * var(--ui-font-scale))', padding: '2px 8px', borderRadius: 4,
                  color: aiCfg.hasTavilyKey ? 'var(--success)' : 'var(--text-muted)',
                  background: aiCfg.hasTavilyKey ? 'var(--success-bg)' : 'var(--hover)',
                }}>
                  {aiCfg.hasTavilyKey ? '已配置' : '未配置'}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <AutoSaveInput
                  type="password"
                  value=""
                  placeholder={aiCfg.hasTavilyKey ? '输入以覆盖，留空不改动' : '输入 Tavily API Key'}
                  onCommit={key => setTavilyKey(key)}
                  clearAfterSave
                  onClear={aiCfg.hasTavilyKey ? async () => { await clearTavilyKey(); toast('已清除 Tavily Key', 'success'); } : undefined}
                  validate={key => key.trim() ? undefined : '留空不改动'}
                  style={{ flex: 1 }}
                />
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
                      <span style={{ flex: 1, fontSize: 'calc(12px * var(--ui-font-scale))', color: 'var(--text-primary)' }}>
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
                        onChange={(v) => { void save(() => setPermLevel(name, v)); }}
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
            <Field title="默认编辑命令" description="本地文件双击打开时执行的命令；{file} 替换为文件路径，省略时追加路径；__system__ 使用系统默认应用打开。命令不可用时依次尝试 vim、nano、vi。">
              <AutoSaveInput
                key="local-editor"
                testId="editor-local-command"
                value={fileCfg.defaultEditor}
                placeholder="例如 edit {file}，或 __system__"
                onCommit={defaultEditor => updateFileCfg({ defaultEditor })}
              />
            </Field>
            <Field title="按扩展名打开" description="为不同扩展名指定打开命令；{file} 为路径占位符，__system__ 表示用系统默认应用。">
              <TemplateListEditor
                key="local-templates"
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
            <Field title="默认编辑命令" description="远程文件双击打开时在 SSH 终端执行的命令；{file} 替换为远程文件路径，省略时追加路径。">
              <AutoSaveInput
                key="remote-editor"
                testId="editor-remote-command"
                value={fileCfg.remoteEditor}
                placeholder="例如 vim {file}"
                onCommit={remoteEditor => updateFileCfg({ remoteEditor })}
              />
            </Field>
            <Field title="按扩展名打开" description="为远程不同扩展名指定打开命令；{file} 为路径占位符。">
              <TemplateListEditor
                key="remote-templates"
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

  return (
    <div className="settings-view" style={{
      flex: 1, minHeight: 0, display: 'flex', flexDirection: 'row',
      background: 'var(--canvas)', userSelect: 'none',
    }}>
      {/* 侧栏 */}
      <aside className="settings-navigation" style={{
        width: 192, flexShrink: 0, background: 'var(--sidebar-bg)',
        display: 'flex', flexDirection: 'column', minHeight: 0,
      }}>
        <div style={{ padding: 8 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 8px',
            borderRadius: 'var(--radius-inner)', background: 'var(--block)',
          }}>
            <Search size={iconSizes.compact} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索设置…"
              style={{
                flex: 1, minWidth: 0, background: 'transparent', border: 'none',
                outline: 'none', fontSize: 'var(--fs-label)', color: 'var(--text-primary)',
              }}
            />
          </div>
        </div>
        <div className="scroll-region" style={{ flex: 1, overflowY: 'auto', padding: '0 6px 8px' }}>
          {visibleGroups.map((g) => {
            const Icon = g.icon;
            const open = normalizedQuery ? true : expanded.has(g.id);
            return (
              <div key={g.id} style={{ marginBottom: 2 }}>
                <button
                  aria-expanded={open}
                  onClick={() => toggleGroup(g.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, width: '100%',
                    padding: '8px 10px', fontSize: 'var(--fs-label)', lineHeight: '20px', fontWeight: 600,
                    background: 'transparent', border: 'none', borderRadius: 'var(--radius-inner)',
                    color: 'var(--text-primary)', cursor: 'pointer',
                  }}
                >
                  <ChevronRight
                    size={iconSizes.compact}
                    style={{ color: 'var(--text-muted)', transition: 'transform 0.12s ease', transform: open ? 'rotate(90deg)' : 'none' }}
                  />
                  <Icon size={iconSizes.control} style={{ color: 'var(--text-muted)' }} />
                  {g.label}
                </button>
                {open && g.items.map((it) => (
                  <button
                    key={it.id}
                    aria-current={selected === it.id ? 'page' : undefined}
                    onClick={() => setSelected(it.id)}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      padding: '7px 10px 7px 32px', fontSize: 'var(--fs-label)', lineHeight: '20px',
                      background: selected === it.id ? 'var(--selection-bg)' : 'transparent',
                      border: 'none', borderRadius: 'var(--radius-inner)', cursor: 'pointer',
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
            <div style={{ padding: 16, textAlign: 'center', fontSize: 'calc(12px * var(--ui-font-scale))', color: 'var(--text-muted)' }}>
              无匹配设置
            </div>
          )}
        </div>
      </aside>

      {/* 内容区 */}
      <section className="settings-content" style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '24px 28px', background: 'var(--canvas)' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          marginBottom: 24,
        }}>
          <Settings size={iconSizes.row} style={{ color: 'var(--text-muted)' }} />
          <span style={{ fontSize: 'var(--fs-title)', fontWeight: 600, color: 'var(--text-primary)' }}>{activeLabel}</span>
        </div>
        <div className="settings-page-body">
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginBottom: 16, fontSize: 'var(--fs-caption)', color: 'var(--text-muted)' }}>
            <span>选择项立即保存，文本停止输入后自动保存。</span>
            <SaveStatus status={status} onRetry={retry} />
          </div>
          {renderPage()}
        </div>
      </section>
    </div>
  );
}
