import { invoke } from '@platform/diagnostics';
import { openPath } from '@tauri-apps/plugin-opener';
import { normPath } from '@platform/path';
import { safeLocalStorageGet, safeLocalStorageSet } from '@utils/errorHandler';
import { t } from '@i18n';
import type { ShellType } from '@platform/shells';

/**
 * fileOpen — file opening logic for the file panel.
 *
 * Pure policy (shell resolution / extension / template parsing / command construction / editor availability detection and fallback)
 * lives in the backend file_open command; the frontend keeps only localStorage config access,
 * opening with the system default app (openPath) and writing commands into the terminal (write callback).
 *
 * Single click on a file → run the editor command in the active terminal; the context menu can open it with the system default app.
 * Templates are configured per extension, placeholder {file} (appended to the command when absent);
 * the special value __system__ opens with the system default app.
 * When the editor is unavailable, fall back from the configured editor to other installed terminal editors, then the system default app.
 */

/** Template special value: open with the system default app */
export const SYSTEM_DEFAULT = '__system__';

export interface FileOpenConfig {
  /** Default terminal editor command (for example a terminal text editor or an IDE launcher) */
  defaultEditor: string;
  /** Extension (lowercase, no dot) → command template */
  templates: Record<string, string>;
  /** Default remote editor command (used when a remote file is opened) */
  remoteEditor: string;
  /** Remote extension → command template */
  remoteTemplates: Record<string, string>;
}

const STORAGE_KEY = 'vrykell-file-open';

export const DEFAULT_CONFIG: FileOpenConfig = {
  defaultEditor: 'vim',
  templates: {},
  remoteEditor: 'vim',
  remoteTemplates: {},
};

// ── Config read/write ──

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function recordOr(value: unknown): Record<string, string> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, string>)
    : {};
}

export function loadConfig(): FileOpenConfig {
  try {
    const raw = safeLocalStorageGet(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CONFIG };
    const parsed = JSON.parse(raw) as Partial<FileOpenConfig>;
    return {
      defaultEditor: stringOr(parsed.defaultEditor, DEFAULT_CONFIG.defaultEditor),
      templates: recordOr(parsed.templates),
      remoteEditor: stringOr(parsed.remoteEditor, DEFAULT_CONFIG.remoteEditor),
      remoteTemplates: recordOr(parsed.remoteTemplates),
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(cfg: FileOpenConfig) {
  return safeLocalStorageSet(STORAGE_KEY, JSON.stringify(cfg));
}

// ── Template text (for the settings UI): one ext=command per line ──

export function parseTemplatesText(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const ext = trimmed.slice(0, eq).trim().toLowerCase().replace(/^\./, '');
    const cmd = trimmed.slice(eq + 1).trim();
    if (ext && cmd) out[ext] = cmd;
  }
  return out;
}

export function serializeTemplates(templates: Record<string, string>): string {
  return Object.entries(templates)
    .map(([ext, cmd]) => `${ext}=${cmd}`)
    .join('\n');
}

// ── Remote open command construction (built in the frontend, written to the SSH terminal) ──

/** Lowercase extension (empty for hidden files without a dot or with a leading dot). */
function extOf(path: string): string {
  const base = path.split('/').pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

/** POSIX shell single-quote quoting */
function shellQuote(path: string): string {
  return `'${path.replace(/'/g, "'\\''")}'`;
}

/** Builds the remote open command from the remote template/default editor; replaces {file} when present, otherwise appends the quoted path. */
export function remoteOpenCommand(cfg: FileOpenConfig, path: string): string {
  if (/[\x00-\x1f\x7f-\x9f]/.test(path)) throw new Error(t('Files with control characters cannot be opened in a terminal.'));
  const tpl = cfg.remoteTemplates[extOf(path)] ?? cfg.remoteEditor;
  const cmd = tpl.includes('{file}') ? tpl.split('{file}').join(shellQuote(path)) : `${tpl} ${shellQuote(path)}`;
  return cmd.endsWith('\n') ? cmd : `${cmd}\n`;
}

// ── Open entry points ──

export type OpenResult =
  | { via: 'terminal'; editor: string; fellBack: boolean }
  | { via: 'system'; degraded: boolean };

/** Shape returned by the file_open command (tag=via, camelCase) */
interface FileOpenResultRust {
  via: 'terminal' | 'system';
  editor?: string;
  command?: string;
  fellBack?: boolean;
  degraded?: boolean;
}

/**
 * Opens a file. With the terminal route, the command is written through the write callback (the caller adds the newline / writes to the PTY).
 */
export async function openFile(
  path: string,
  write: (commandLine: string) => void,
  shell?: ShellType,
): Promise<OpenResult> {
  const cfg = loadConfig();
  const res = await invoke<FileOpenResultRust>('file_open', { path, cfg: shell ? { ...cfg, shell } : cfg });

  if (res.via === 'terminal') {
    write(res.command ?? '');
    return { via: 'terminal', editor: res.editor ?? '', fellBack: res.fellBack ?? false };
  }

  await openPath(normPath(path));
  return { via: 'system', degraded: res.degraded ?? false };
}
