import { useTerminalDefaults } from '@config/terminalDefaults';
import { useCommandHistorySettings } from '@config/commandHistory';
import { useGitPreferences } from '@config/git';
import { useEditorPreferences } from '@config/editor';
import { t } from '@i18n';
import { TOOL_NAMES, usePermissions, useAgentSettings, useUsageStore, type ToolName, type AgentSettings } from '@features/agent';
import { summarize, totalTokens, formatTokens } from '@features/agent/model/usageStats';
import { SHELL_TYPES, shellTypeLabel } from '@platform/shells';
import { useStartupSettings } from '../stores/startup';
import { isApiKeyConfigured, getModel } from '@features/agent/stores/aiConfig';
import { loadConfig } from '@features/files/services/fileOpen';
import { useSessionStore } from '@features/workspace';
import { useTypographyStore } from '@config/typography';
import { useSettingsNavigationStore } from '../stores/navigation';
import type { PageId } from '../model/navigation';
import { terminalDebug } from '@features/terminal/services/terminalDebug';

export interface SettingDef {
  id: string;
  page?: PageId;
  label: string;
  desc: string;
  keywords?: string[];
  getValue: () => string;
  onSelect: () => void;
}

const settings: SettingDef[] = [];
export function registerSetting(setting: SettingDef): void {
  if (!settings.some(item => item.id === setting.id)) settings.push(setting);
}
export function getSettings(): SettingDef[] { return settings; }
export function searchSettings(query: string): SettingDef[] {
  const words = query.trim().toLowerCase().split(/\s+/);
  return settings.filter(setting => words.every(word => `${setting.label} ${setting.desc} ${(setting.keywords ?? []).join(" ")}`.toLowerCase().includes(word)));
}

function registerField(id: string, page: PageId, label: string, description: string, value: () => string = () => '', target = label, control?: string, aliases: string[] = []): void {
  registerSetting({ id, page, label: t(label), desc: t(description), keywords: [label, description, ...aliases, ...aliases.map(alias => t(alias))], getValue: value, onSelect: () => {
    useSettingsNavigationStore.getState().openField(page, t(target), control);
    useSessionStore.getState().openSettingsTab();
    terminalDebug('settings-navigation', { page, settingId: id });
  } });
}

registerField('local-file-undo', 'file-operations', 'Local file undo', 'File operations');
registerField('remote-file-undo', 'file-operations', 'Remote file undo', 'File operations');
registerField('git-diff-pages', 'source-control', 'Diff pages', 'Source control', () => useGitPreferences.getState().diffMode);
registerField('preferred-file-editor', 'editor-local', 'Preferred file editor', 'Opening files', () => useEditorPreferences.getState().localOpenMode);
registerField('embedded-editor-pages', 'editor-local', 'Editor pages', 'Opening files', () => useEditorPreferences.getState().pageMode);
registerField("startup", "startup", "Open on startup", "Restore sessions or open a default terminal", () => useStartupSettings.getState().mode);
registerField('history-run-target', 'command-history', 'Command execution target', 'Choose where commands run from the history panel.', () => useCommandHistorySettings.getState().runIn);
registerField('history-double-click', 'command-history', 'Double-click command', 'Double-click inserts the command by default. Execution follows the selected target.', () => useCommandHistorySettings.getState().doubleClick);
registerField('command-highlighting', 'appearance-typography', 'Command syntax highlighting', 'Color commands, arguments and shell operators.', () => String(useTypographyStore.getState().commandHighlighting));
registerField("logs", "logs", "Save diagnostic logs automatically", "Diagnostic logging and errors");
registerField('context-menu', 'context-menu', 'Windows context menu', 'Open in Vrykell', undefined, 'Open in Vrykell');
registerField("export-logs", "logs", "Export logs", "Diagnostic archive");
registerField("api-key", "ai-model", "Provider API Key", "Credentials for the current model provider", () => isApiKeyConfigured() ? t('Configured') : t('Not configured'));
registerField("model", "ai-model", "Model list", "Provider, base URL and model ID", getModel);
registerField("scope", "ai-behavior", "Configuration scope", "Global or per-model behavior");
registerField("system-prompt", "ai-behavior", "System prompt", "AI role and instructions", () => globalValue("systemPrompt"));
registerField("agent-mode", "ai-behavior", "Agent mode", "Enable tool calls", () => globalValue("agentMode"));
registerField("max-steps", "ai-behavior", "Maximum iterations", "Maximum tool execution rounds", () => globalValue("maxSteps"));
registerField("context-strategy", "ai-behavior", "Context strategy", "Full history, window or summary", () => globalValue("contextStrategy"));
registerField("context-budget", "ai-behavior", "Context token budget", "Limit context size", () => globalValue("contextMaxTokens"));
registerField("summary-limit", "ai-behavior", "Summary length limit", "Summary token budget", () => globalValue("contextSummaryTokens"));
registerField("tool-truncation", "ai-behavior", "Tool output truncation", "Limit tool result length", () => globalValue("contextToolChars"));
registerField("reply-limit", "ai-behavior", "Reply token limit", "Maximum response tokens", () => globalValue("maxOutputTokens"));
registerField("temperature", "ai-behavior", "Sampling temperature", "Response randomness", () => globalValue("temperature"));
registerField("smart-title", "ai-behavior", "Smart session titles", "Automatic title generation", () => globalValue("autoTitle"));
registerField("title-model", "ai-behavior", "Title model", "Model for title generation", () => globalValue("titleModel"));
registerField("completion", "ai-behavior", "Command completion", "Terminal suggestions", () => globalValue("completeEnabled"));
registerField("completion-delay", "ai-behavior", "Completion debounce", "Delay before suggestions", () => globalValue("completeDebounceMs"));
registerField("completion-model", "ai-behavior", "Completion model", "Model for command completion", () => globalValue("completeModel"));
registerField("permissions", "ai-perms", "Tool permissions", "Allow, ask or deny tools");
registerField("approval-timeout", "ai-perms", "Approval timeout", "Deny an approval nobody answers", () => `${usePermissions.getState().approvalTimeoutSeconds}`);
registerField("session-grants", "ai-perms", "Session grants", "Clear temporary permissions");
registerField("tavily-key", "ai-web", "Tavily API Key", "Web search credentials");
registerField("mcp", "ai-mcp", "MCP servers", "External tool connections");
registerField("file-open", "editor-local", "Default editing command", "Local terminal editor command", () => loadConfig().defaultEditor, "Default editing command", undefined, ["File open-with"]);
registerField("file-extensions", "editor-local", "Open by extension", "Local file extension commands", () => Object.keys(loadConfig().templates).join(", "));
registerField("remote-editor", "editor-remote", "Default remote editing command", "SSH terminal editor");
registerField("remote-extensions", "editor-remote", "Remote extension commands", "Remote file extension commands");
registerField("theme", "appearance-theme", "Theme", "Dark and light appearance", () => document.documentElement.dataset.theme ?? "dark");
registerField("opacity", "appearance-theme", "Application opacity", "Background transparency");
registerField("wallpaper", "appearance-theme", "Application background image", "Wallpaper");
registerField("theme-import", "appearance-files", "Import / export theme", "Theme JSON");
registerField("ui-font", "appearance-typography", "settings.font.pageTitle", "settings.font.pageTitle", () => String(useTypographyStore.getState().uiFontSize));
registerField("terminal-font", "appearance-typography", "settings.font.terminalTitle", "settings.font.terminalTitle", () => String(useTypographyStore.getState().terminalFontSize));
registerField('chat-font', 'appearance-typography', 'AI chat font size', 'Adjust text size in the AI chat panel. Changes are saved and applied immediately.', () => String(useTypographyStore.getState().chatFontSize));
registerField('terminal-font-family', 'appearance-typography', 'Terminal font family', 'Use a font installed on your system; unavailable families use the fallback fonts.', () => useTypographyStore.getState().terminalFontPreset);
registerField('terminal-font-weight', 'appearance-typography', 'Terminal font weight', 'Variable fonts support fine weight adjustments; static fonts use the nearest installed weight.', () => String(useTypographyStore.getState().terminalFontWeight));
registerField('terminal-line-spacing', 'appearance-typography', 'Terminal line spacing', 'Adjust line spacing for terminal input, live output and command history.', () => String(useTypographyStore.getState().terminalLineHeight));
registerField("terminal-renderer", "appearance-typography", "settings.font.rendererTitle", "settings.font.rendererTitle", () => String(useTypographyStore.getState().terminalRenderer));

function globalValue(key: keyof AgentSettings): string {
  const value = useAgentSettings.getState().global[key];
  return typeof value === 'boolean' ? t(value ? 'Enabled' : 'Disabled') : String(value ?? '');
}
registerField('default-terminal', 'terminal-open', 'Default terminal', 'Used for new tabs, startup and opening files in a terminal.', () => useTerminalDefaults.getState().shell);
for (const shell of SHELL_TYPES) {
  registerField(`open-mode-${shell}`, 'terminal-open', t('Open mode for {{shell}}', { shell: shellTypeLabel(shell) }), 'settings.openMode.description',
    () => useAgentSettings.getState().global.openModeByShell[shell], 'settings.openMode.title', t('settings.openMode.aria', { shell: shellTypeLabel(shell) }));
}
registerField('open-mode-ssh', 'terminal-open', 'SSH open mode', 'settings.openMode.description',
  () => useAgentSettings.getState().global.sshOpenMode, 'settings.openMode.title', t('settings.openMode.sshAria'));

const permissionLabels: Record<ToolName, string> = {
  "run_command": "Run terminal commands",
  "read_file": "Read files",
  "write_file": "Write files",
  "edit_file": "Edit files",
  "list_dir": "List directories",
  "search_files": "Search files",
  "web_search": "Search the web",
  "web_fetch": "Fetch web pages",
  "web_crawl": "Crawl web pages",
  "read_terminal": "Read terminal output",
  "terminal_keys": "Send terminal keys",
  "use_skill": "Use skills",
  "install_skill": "Install skills",
  "mcp": "MCP server tools",
  "memory": "Write memory",
  "schedule": "Manage schedules",
  "subagent": "Delegate subagents"
};
for (const tool of TOOL_NAMES) {
  const label = permissionLabels[tool];
  registerField(`permission-${tool}`, 'ai-perms', label, 'Tool permissions',
    () => usePermissions.getState().levels[tool] ?? 'ask', 'Tool permissions', t('{{tool}} permission', { tool: t(label) }));
}

// Token usage opens the side panel instead of a settings page, so the entry carries its
// own action and reports the all-time total as its value.
registerSetting({
  id: 'usage',
  label: t('Usage'),
  desc: t('Token usage and request counts for AI calls.'),
  keywords: ['usage', 'token', 'tokens', '用量', '用量统计', 'token 统计'],
  getValue: () => {
    const totals = summarize(useUsageStore.getState().records);
    return t('{{tokens}} tokens in {{count}} requests', { tokens: formatTokens(totalTokens(totals)), count: totals.turns });
  },
  onSelect: () => useSessionStore.getState().openUsageTab(),
});

// The ACP page is a settings destination like the others; the launcher lives in the sidebar.
registerSetting({
  id: 'harness',
  label: t('ACP'),
  desc: t('External coding agents you add yourself; connecting runs the program you configure.'),
  keywords: ['harness', 'acp', 'agent', 'claude', 'codex', 'gemini', 'harness 中心', '外部 harness'],
  getValue: () => t('Add or connect a server'),
  onSelect: () => {
    useSettingsNavigationStore.getState().openField('ai-harness', t('ACP'));
    useSessionStore.getState().openSettingsTab();
  },
});
