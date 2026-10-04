import { invoke } from '@tauri-apps/api/core';
import { openPath } from '@tauri-apps/plugin-opener';
import { safeLocalStorageGet, safeLocalStorageSet } from '@utils/errorHandler';

/**
 * fileOpen — 文件面板的文件打开逻辑。
 *
 * 纯策略（shell 引用 / 扩展名 / 模板解析 / 命令构造 / 编辑器可用性检测与降级）
 * 已下沉到 Rust 的 file_open 命令；前端只保留 localStorage 配置读写、系统默认
 * 应用打开（openPath）与把命令写进终端（write 回调）。
 *
 * 单击文件 → 在活跃终端里跑编辑器命令；右键可选系统默认应用。
 * 模板按扩展名配置，占位符 {file}（缺省追加到命令末尾）；
 * 特殊值 __system__ 表示用系统默认应用打开。
 * 编辑器不可用时按 [配置的编辑器 → vim → nano → vi → 系统默认应用] 降级。
 */

/** 模板特殊值：用系统默认应用打开 */
export const SYSTEM_DEFAULT = '__system__';

export interface FileOpenConfig {
  /** 默认终端编辑器命令（如 vim / nano / code） */
  defaultEditor: string;
  /** 扩展名（小写、不含点）→ 命令模板 */
  templates: Record<string, string>;
  /** 远程默认编辑器命令（远程文件双击打开时用） */
  remoteEditor: string;
  /** 远程扩展名 → 命令模板 */
  remoteTemplates: Record<string, string>;
}

const STORAGE_KEY = 'vrykell-file-open';

export const DEFAULT_CONFIG: FileOpenConfig = {
  defaultEditor: 'vim',
  templates: {},
  remoteEditor: 'vim',
  remoteTemplates: {},
};

// ── 配置读写 ──

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

// ── 模板文本（设置 UI 用）：每行 ext=命令 ──

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

// ── 远程打开命令构造（前端拼接，写进 SSH 终端） ──

/** 取小写扩展名（无点或点开头隐藏文件返回空串）。 */
function extOf(path: string): string {
  const base = path.split('/').pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

/** POSIX shell 单引号引用 */
function shellQuote(path: string): string {
  return `'${path.replace(/'/g, "'\\''")}'`;
}

/** 按远程模板/远程默认编辑器构造远程打开命令；有 {file} 替换，无则追加引用路径。 */
export function remoteOpenCommand(cfg: FileOpenConfig, path: string): string {
  const tpl = cfg.remoteTemplates[extOf(path)] ?? cfg.remoteEditor;
  const cmd = tpl.includes('{file}') ? tpl.replace('{file}', shellQuote(path)) : `${tpl} ${shellQuote(path)}`;
  return cmd.endsWith('\n') ? cmd : `${cmd}\n`;
}

// ── 打开入口 ──

export type OpenResult =
  | { via: 'terminal'; editor: string; fellBack: boolean }
  | { via: 'system'; degraded: boolean };

/** Rust file_open 命令的返回形状（serde tag=via，camelCase） */
interface FileOpenResultRust {
  via: 'terminal' | 'system';
  editor?: string;
  command?: string;
  fellBack?: boolean;
  degraded?: boolean;
}

/**
 * 打开文件。terminal 方式通过 write 回调写入命令（调用方拼换行/写 PTY）。
 */
export async function openFile(
  path: string,
  write: (commandLine: string) => void,
): Promise<OpenResult> {
  const cfg = loadConfig();
  const res = await invoke<FileOpenResultRust>('file_open', { path, cfg });

  if (res.via === 'terminal') {
    write(res.command ?? '');
    return { via: 'terminal', editor: res.editor ?? '', fellBack: res.fellBack ?? false };
  }

  await openPath(path);
  return { via: 'system', degraded: res.degraded ?? false };
}
