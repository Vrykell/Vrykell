import { OutlineButton } from '@ui/OutlineButton';
import { t } from '@i18n';
import SidebarItem from '@ui/sidebarItem';
import { TextInput } from '@ui/TextInput';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { iconSizes, Search  } from '@ui/icons';
import { loadConfig, saveConfig, type FileOpenConfig } from '@features/files/services/fileOpen';
import { refreshAiConfig, setTavilyKey, clearTavilyKey, useAiConfigStore } from '@features/agent';
import SkillsSettings from '@features/settings/pages/SkillsSettings';
import { MemorySettings, AgentsSettings, SchedulesSettings } from '@features/settings/pages/AgentExtrasSettings';
import Select from '@ui/Select';
import { useToastStore } from '@ui/Toast';
import {
  usePermissions, clearSessionGrants, TOOL_NAMES,
  type ToolLevel, type ToolName,
} from '@features/agent';
import { SettingsGroup, Field, TemplateListEditor } from '@features/settings/components/ui';
import { AiModelPage } from '@features/settings/pages/aiModelPage';
import { AiBehaviorPage } from '@features/settings/pages/aiBehaviorPage';
import { McpPage } from '@features/settings/pages/mcpPage';
import { TerminalOpenPage } from '@features/settings/pages/terminalOpenPage';
import { ThemePage } from '@features/settings/pages/themePage';
import { ShortcutPage } from '@features/settings/pages/shortcutPage';
import { SETTINGS_GROUPS, useSettingsNavigation } from '@features/settings/hooks/useSettingsNavigation';
import AutoSaveInput from '../components/AutoSaveInput';
import SaveStatus from '../components/SaveStatus';
import { SettingsSaveProvider, useSettingsSave } from '../components/SettingsSaveProvider';
import { StartupPage } from './startupPage';
import { LogsPage } from './logsPage';
import { ContextMenuPage } from './contextMenuPage';

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

/** Static grouped navigation and a single page-level save summary. */
export default function SettingsView() {
  return <SettingsSaveProvider><SettingsContent /></SettingsSaveProvider>;
}

function SettingsContent() {
  const navigationRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !navigationRef.current?.contains(event.target)) setSearchOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, []);
  const { save, status, retry } = useSettingsSave();
  const {
    selected,
    setSelected,
    query,
    setQuery,
    normalizedQuery,
    visibleGroups,
    matchingSettings,
    activeLabel,
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
      case 'context-menu': return <ContextMenuPage />;
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
          <SettingsGroup title={t('Search services')}>
            <Field title="当前搜索方式" description={t('Web search works without configuration.')}>
              <span style={{
                fontSize: 'calc(11px * var(--ui-font-scale))', padding: '2px 8px', borderRadius: 4,
                color: 'var(--text-secondary)', background: 'var(--hover)',
              }}>
                {mode}
              </span>
            </Field>
            <Field layout="stacked" title="Tavily API Key" description={t('Optional search key. Without it, use the built-in fallback.')}>
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
          </SettingsGroup>
        );
      }

      case 'ai-perms':
        return (
          <SettingsGroup title={t('Tool access')}>
            <Field
              layout="stacked"
              title="工具权限"
              description={t("Choose which tools may run. Dangerous commands always require approval.")}
            >
              <div className="settings-option-list">
                {TOOL_NAMES.map((name) => {
                  const lv: ToolLevel = permLevels[name] ?? 'ask';
                  return (
                    <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ flex: 1, fontSize: 'calc(12px * var(--ui-font-scale))', color: 'var(--text-primary)' }}>
                        {PERM_TOOL_LABEL[name]}
                      </span>
                      <Select
                        aria-label={`${PERM_TOOL_LABEL[name]} 权限`}
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
              description={t("Temporary tool approvals expire on restart or when cleared.")}
            >
              <OutlineButton

                onClick={() => {
                  clearSessionGrants();
                  toast('已清空全部会话授权', 'success');
                }}
              >
                清空会话授权
              </OutlineButton>
            </Field>
          </SettingsGroup>
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
          <SettingsGroup title={t('Opening files')}>
            <Field title="默认编辑命令" description={t("Use {file} for the path or __system__ for the default app. Unavailable editors fall back to vim, nano or vi.")}>
              <AutoSaveInput
                key="local-editor"
                testId="editor-local-command"
                value={fileCfg.defaultEditor}
                placeholder="例如 edit {file}，或 __system__"
                onCommit={defaultEditor => updateFileCfg({ defaultEditor })}
              />
            </Field>
            <Field layout="stacked" title="按扩展名打开" description={t("Set an opening command per extension, using {file} or __system__.")}>
              <TemplateListEditor
                key="local-templates"
                value={fileCfg.templates}
                onChange={(templates) => updateFileCfg({ templates })}
                placeholder="如 code、__system__"
              />
            </Field>
          </SettingsGroup>
        );

      case 'editor-remote':
        return (
          <SettingsGroup title={t('Opening files')}>
            <Field title="默认编辑命令" description={t("Run this editor over SSH. Use {file} for the remote path.")}>
              <AutoSaveInput
                key="remote-editor"
                testId="editor-remote-command"
                value={fileCfg.remoteEditor}
                placeholder="例如 vim {file}"
                onCommit={remoteEditor => updateFileCfg({ remoteEditor })}
              />
            </Field>
            <Field layout="stacked" title="按扩展名打开" description={t("Set an opening command per remote extension, using {file} for the path.")}>
              <TemplateListEditor
                key="remote-templates"
                value={fileCfg.remoteTemplates}
                onChange={(remoteTemplates) => updateFileCfg({ remoteTemplates })}
                placeholder="如 nvim、less"
              />
            </Field>
          </SettingsGroup>
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
      <div className="settings-layout">
        {/* Navigation shares the available settings width with the content. */}
        <aside ref={navigationRef} className="settings-navigation" data-search-open={searchOpen && Boolean(normalizedQuery)}
          onBlur={event => {
            if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) setSearchOpen(false);
          }}
          onKeyDown={event => {
            if (event.key === 'Escape' && searchOpen) {
              event.preventDefault(); event.stopPropagation(); searchRef.current?.focus(); setSearchOpen(false);
            } else if (['ArrowDown', 'ArrowUp'].includes(event.key) && event.target instanceof Element
              && event.target.closest('.settings-navigation-list')) {
              event.preventDefault(); event.stopPropagation();
              const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('.settings-navigation-list button:not(:disabled)')];
              const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
              buttons[(current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
            }
          }} style={{
          background: 'var(--sidebar-bg)',
          display: 'flex', flexDirection: 'column', minHeight: 0,
        }}>
          <div className="settings-navigation-tools">
            <div className="settings-navigation-search" style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 8px',
              borderRadius: 'var(--radius-inner)', background: 'var(--field-bg)',
            }}>
              <Search size={iconSizes.compact} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
              <TextInput
                ref={searchRef}
                aria-label={t('Search settings…')}
                value={query}
                onFocus={() => setSearchOpen(true)}
                onClick={() => setSearchOpen(true)}
                onChange={(e) => { setQuery(e.target.value); setSearchOpen(true); }}
                onKeyDown={event => {
                  if (event.key === 'ArrowDown' && normalizedQuery) {
                    event.preventDefault(); setSearchOpen(true);
                    requestAnimationFrame(() => navigationRef.current?.querySelector<HTMLButtonElement>('.settings-navigation-list button')?.focus());
                  }
                }}
                placeholder={t('Search settings…')}
                style={{
                  flex: 1, minWidth: 0, background: 'transparent', border: 'none',
                  outline: 'none', fontSize: 'var(--fs-label)', color: 'var(--text-primary)',
                }}
              />
            </div>
            <div className="settings-compact-navigation">
              <Select aria-label={t('Settings page')} value={selected}
                options={SETTINGS_GROUPS.flatMap(group => group.items.map(item => ({
                  value: item.id, label: `${group.label} · ${item.label}`, triggerLabel: item.label,
                })))}
                onChange={setSelected} style={{ width: '100%' }} />
            </div>
          </div>
          <div className="settings-navigation-list scroll-region" data-searching={Boolean(normalizedQuery)}>
            {normalizedQuery && matchingSettings.map(setting => (
              <button key={setting.id} className="settings-search-result" onClick={() => { setting.onSelect(); setQuery(''); }}>
                <span>{setting.label}</span>
                <small>{SETTINGS_GROUPS.flatMap(group => group.items).find(item => item.id === setting.page)?.label ?? activeLabel} · {setting.desc}</small>
              </button>
            ))}
            {(!normalizedQuery || matchingSettings.length === 0) && visibleGroups.map((g) => {
              return (
                <div key={g.id} className="settings-nav-group">
                  <div className="settings-nav-heading">{g.label}</div>
                  {g.items.map(item => {
                    const Icon = item.icon;
                    return <SidebarItem compact key={item.id} icon={<Icon size={iconSizes.row} />}
                      title={item.label} tooltip={item.label} active={selected === item.id} tabIndex={0}
                      style={{ fontSize: 'var(--fs-label)' }}
                      dataAttributes={{ role: 'button', 'aria-label': item.label, 'aria-current': selected === item.id ? 'page' : undefined }}
                      onClick={() => setSelected(item.id)}
                      onKeyDown={event => {
                        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelected(item.id); }
                      }} />;
                  })}
                </div>
              );
            })}
            {normalizedQuery && matchingSettings.length === 0 && visibleGroups.length === 0 && (
              <div style={{ padding: 16, textAlign: 'center', fontSize: 'calc(12px * var(--ui-font-scale))', color: 'var(--text-muted)' }}>
                {t('No matching settings')}
              </div>
            )}
          </div>
        </aside>

        {/* Content retains a readable width before falling back to horizontal scrolling. */}
        <section className="settings-content">
          <header className="settings-page-header">
            <h1>{activeLabel}</h1>
            <div className="settings-save-hint">
              <span>{t('Options save immediately; text saves after you stop typing.')}</span>
              <SaveStatus status={status} onRetry={retry} />
            </div>
          </header>
          <div className="settings-page-body">
            {renderPage()}
          </div>
        </section>
      </div>
    </div>
  );
}
