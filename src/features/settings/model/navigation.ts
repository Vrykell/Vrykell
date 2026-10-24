import { isWindows } from '@platform/runtime';
import type { ShellType } from '@platform/shells';

export type PageId = `profile:${ShellType}` | 'application-language' | 'ai-model' | 'ai-behavior' | 'ai-perms' | 'ai-web' | 'ai-skill' | 'ai-mcp' | 'ai-memory' | 'ai-agents' | 'ai-schedules' | 'ai-harness' | 'command-history' | 'editor-preferences' | 'editor-local' | 'editor-remote' | 'appearance-theme' | 'appearance-blocks' | 'appearance-typography' | 'appearance-files' | 'shortcuts' | 'startup' | 'logs' | 'context-menu' | 'file-operations';

/** Platform-specific destinations stay out of navigation, search and restored selections. */
export function isSettingsPageAvailable(page: PageId | undefined, windows = isWindows): boolean {
  return page !== 'context-menu' || windows;
}
