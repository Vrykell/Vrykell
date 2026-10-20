import { FileOperationsPage } from './fileOperationsPage';
import { OutlineButton } from '@ui/OutlineButton';
import { t } from '@i18n';
import { useEffect, useState, type ReactNode } from 'react';
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
import { CommandHistoryPage } from './commandHistoryPage';
import { ThemePage } from '@features/settings/pages/themePage';
import { BlockAppearancePage } from '@features/settings/pages/blockAppearancePage';
import { ThemeFilesPage } from '@features/settings/pages/themeFilesPage';
import { ShortcutPage } from '@features/settings/pages/shortcutPage';
import { useSettingsNavigation } from '@features/settings/hooks/useSettingsNavigation';
import AutoSaveInput from '../components/AutoSaveInput';
import SaveStatus from '../components/SaveStatus';
import SettingsNavigation from '../components/SettingsNavigation';
import FontSettings from '../components/FontSettings';
import { SettingsSaveProvider, useSettingsSave } from '../components/SettingsSaveProvider';
import { StartupPage } from './startupPage';
import { LogsPage } from './logsPage';
import { ContextMenuPage } from './contextMenuPage';
import EditorOpeningPreferences from '../components/EditorOpeningPreferences';
import { LanguagePage } from './languagePage';

/** Permission tool labels use the shared translation catalog. */
const PERM_TOOL_LABEL: Record<ToolName, string> = {
  run_command: "Run terminal command",
  read_file: "Read file",
  write_file: "Write file",
  edit_file: "Edit file",
  list_dir: "List directory",
  search_files: "Search files",
  web_search: "Web search",
  web_fetch: "Fetch web page",
  web_crawl: "Crawl web pages",
  read_terminal: "Read terminal screen",
  terminal_keys: "Send terminal keys",
  use_skill: "Use skill",
  install_skill: "Install skill",
  mcp: "MCP server tools",
  memory: "Write memory",
  schedule: "Manage scheduled tasks",
  subagent: "Delegate subagent",
};

/** Static grouped navigation and a single page-level save summary. */
export default function SettingsView() {
  return <SettingsSaveProvider><SettingsContent /></SettingsSaveProvider>;
}

function SettingsContent() {
  const { save, status, retry } = useSettingsSave();
  const navigation = useSettingsNavigation();
  const { selected, activeLabel } = navigation;

  // File opening preferences are stored locally.
  const [fileCfg, setFileCfg] = useState<FileOpenConfig>(() => loadConfig());
  const updateFileCfg = (patch: Partial<FileOpenConfig>) => {
    const next = { ...loadConfig(), ...patch };
    if (!saveConfig(next)) throw new Error(t("Configuration could not be saved"));
    setFileCfg(next);
  };

  // The configuration store mirrors backend state without exposing credentials.
  const aiCfg = useAiConfigStore();
  const toast = (msg: string, type: 'info' | 'success' | 'error') =>
    useToastStore.getState().addToast(msg, type);

  // Default permission levels are persisted; session grants remain in memory.
  const permLevels = usePermissions((s) => s.levels);
  const setPermLevel = usePermissions((s) => s.setLevel);

  useEffect(() => {
    refreshAiConfig();
  }, []);

  const renderPage = (): ReactNode => {
    switch (selected) {
      case 'application-language': return <LanguagePage />;
      case 'file-operations': return <FileOperationsPage />;
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
            ? t("Provider search")
            : aiCfg.hasTavilyKey
              ? 'Tavily'
              : t("Fallback search");
        return (
          <SettingsGroup title={t('Search services')}>
            <Field title={t("Current search method")} description={t('Web search works without configuration.')}>
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
                  {aiCfg.hasTavilyKey ? t("Configured") : t("Not configured")}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <AutoSaveInput
                  type="password"
                  value=""
                  placeholder={aiCfg.hasTavilyKey ? t("Enter to replace; leave empty to keep the current value") : t("Enter Tavily API Key")}
                  onCommit={key => setTavilyKey(key)}
                  clearAfterSave
                  onClear={aiCfg.hasTavilyKey ? async () => { await clearTavilyKey(); toast(t("Tavily key cleared"), 'success'); } : undefined}
                  validate={key => key.trim() ? undefined : t("Leave empty to keep the current value")}
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
              title={t("Tool permissions")}
              description={t("Choose which tools may run. Dangerous commands always require approval.")}
            >
              <div className="settings-option-list">
                {TOOL_NAMES.map((name) => {
                  const lv: ToolLevel = permLevels[name] ?? 'ask';
                  return (
                    <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ flex: 1, fontSize: 'calc(12px * var(--ui-font-scale))', color: 'var(--text-primary)' }}>
                        {t(PERM_TOOL_LABEL[name])}
                      </span>
                      <Select
                        aria-label={t('Permissions for {{tool}}', { tool: t(PERM_TOOL_LABEL[name]) })}
                        options={(
                          [
                            ['allow', t("Allow")],
                            ['ask', t("Ask every time")],
                            ['deny', t('Disallow')],
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
              title={t("Session grants")}
              description={t("Temporary tool approvals expire on restart or when cleared.")}
            >
              <OutlineButton

                onClick={() => {
                  clearSessionGrants();
                  toast(t("Session grants cleared"), 'success');
                }}
              >
                {t('Clear session grants')}
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
      case 'command-history':
        return <CommandHistoryPage />;

      case 'editor-local':
        return (
          <SettingsGroup title={t('Opening files')}>
            <EditorOpeningPreferences remote={false} />
            <Field title={t("Default editing command")} description={t("Use {file} for the path or __system__ for the default app. Unavailable editors fall back to vim, nano or vi.")}>
              <AutoSaveInput
                key="local-editor"
                testId="editor-local-command"
                value={fileCfg.defaultEditor}
                placeholder={t("Example: edit {file}, or __system__")}
                onCommit={defaultEditor => updateFileCfg({ defaultEditor })}
              />
            </Field>
            <Field layout="stacked" title={t("Open by extension")} description={t("Set an opening command per extension, using {file} or __system__.")}>
              <TemplateListEditor
                key="local-templates"
                value={fileCfg.templates}
                onChange={(templates) => updateFileCfg({ templates })}
                placeholder={t("Example: code or __system__")}
              />
            </Field>
          </SettingsGroup>
        );

      case 'editor-remote':
        return (
          <SettingsGroup title={t('Opening files')}>
            <EditorOpeningPreferences remote />
            <Field title={t("Default editing command")} description={t("Run this editor over SSH. Use {file} for the remote path.")}>
              <AutoSaveInput
                key="remote-editor"
                testId="editor-remote-command"
                value={fileCfg.remoteEditor}
                placeholder={t("Example: vim {file}")}
                onCommit={remoteEditor => updateFileCfg({ remoteEditor })}
              />
            </Field>
            <Field layout="stacked" title={t("Open by extension")} description={t("Set an opening command per remote extension, using {file} for the path.")}>
              <TemplateListEditor
                key="remote-templates"
                value={fileCfg.remoteTemplates}
                onChange={(remoteTemplates) => updateFileCfg({ remoteTemplates })}
                placeholder={t("Example: nvim or less")}
              />
            </Field>
          </SettingsGroup>
        );

      case 'appearance-theme':
        return <ThemePage />;

      case 'appearance-blocks':
        return <BlockAppearancePage />;

      case 'appearance-typography':
        return <FontSettings />;

      case 'appearance-files':
        return <ThemeFilesPage />;

      case 'shortcuts':
        return <ShortcutPage />;

      default:
        return null;
    }
  };

  return (
    <div className="settings-view" style={{
      flex: 1, minHeight: 0, display: 'flex', flexDirection: 'row',
      background: 'var(--xterm-bg)', userSelect: 'none',
    }}>
      <div className="settings-layout">
        <SettingsNavigation navigation={navigation} />

        {/* Content retains a readable width before falling back to horizontal scrolling. */}
        <section className="settings-content">
          <header className="settings-page-header">
            <div className="settings-page-heading">
              <h1>{activeLabel}</h1>
            </div>
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
