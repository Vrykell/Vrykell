/**
 * complete — terminal command autocomplete.
 *
 * Two-tier engine ("must work without AI too": the local tier is zero-network, zero-key and
 * always available):
 *   1. Local: command-history prefix matching (history store hot cache, newest first) → path
 *      completion (when the last token looks like a path, list the directory with fs_list and
 *      match name prefixes)
 *   2. AI enhancement: when the local tier finds nothing and a key is configured, generate a
 *      completion with generateText (model = agentSettings.completeModel, empty = reuse the chat model)
 *
 * The return value is a "suffix" (the part appended to the current input); the caller renders it as
 * ghost text. Everything is abortable (an input change invalidates the previous attempt) and any
 * failure returns null silently.
 */
import { generateText } from 'ai';
import { invoke } from '@platform/diagnostics';
import { createChatModel } from '@features/agent/services/provider';
import { useAgentSettings } from '@features/agent/stores/agentSettings';
import { activeModelProfile, isApiKeyConfigured } from '@features/agent/stores/aiConfig';
import { useHistoryStore } from '@features/terminal/stores/history';

export interface CompleteOptions {
  cwd?: string;
}

/** Local history prefix match (synchronous, entries are already newest-first); returns the suffix or null. */
export function localComplete(prefix: string): string | null {
  const hit = useHistoryStore
    .getState()
    .entries.find((e) => (e.exitCode === null || e.exitCode === 0) && e.command.length > prefix.length && e.command.startsWith(prefix));
  return hit ? hit.command.slice(prefix.length) : null;
}

/** All local history prefix-match candidates (synchronous, newest first, deduplicated by suffix); returns suffixes (empty array when nothing matches). */
export function localCompleteCandidates(prefix: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of useHistoryStore.getState().entries) {
    if (e.exitCode !== null && e.exitCode !== 0) continue;
    if (e.command.length > prefix.length && e.command.startsWith(prefix)) {
      const suffix = e.command.slice(prefix.length);
      if (!seen.has(suffix)) {
        seen.add(suffix);
        out.push(suffix);
      }
    }
  }
  return out;
}

/** Whether the last token looks like a path (absolute, ./, ../, ~ or contains a slash). */
export function looksLikePath(token: string): boolean {
  return (
    token.startsWith('/') ||
    token.startsWith('./') ||
    token.startsWith('../') ||
    token.startsWith('~/') ||
    token.includes('/')
  );
}

function lastToken(prefix: string): string {
  const m = /(\S+)$/.exec(prefix);
  return m ? m[1]! : '';
}

interface FsEntry {
  name: string;
  is_dir: boolean;
}

/**
 * Path completion: resolve the directory part of the last token (absolute used as-is, relative
 * joined with cwd, ~ not expanded and gives up), then take the first name-prefix match from
 * fs_list. Returns the suffix (directories get a trailing /) or null.
 */
export async function pathComplete(
  prefix: string,
  cwd: string | undefined,
  signal?: AbortSignal,
): Promise<string | null> {
  const token = lastToken(prefix);
  if (!looksLikePath(token)) return null;
  if (token.startsWith('~')) return null; // The frontend does not know the home directory, so ~ is left to the shell.
  const slash = token.lastIndexOf('/');
  const dirPart = token.slice(0, slash + 1);
  const base = token.slice(slash + 1);
  let dirAbs: string;
  if (dirPart.startsWith('/')) {
    dirAbs = dirPart;
  } else {
    if (!cwd) return null;
    dirAbs = cwd.replace(/\/+$/, '') + '/' + dirPart;
  }
  try {
    const entries = await invoke<FsEntry[]>('fs_list', { path: dirAbs });
    if (signal?.aborted) return null;
    const hit = entries.find(
      (e) => e.name.startsWith(base) && e.name !== base && (base.startsWith('.') || !e.name.startsWith('.')),
    );
    if (!hit) return null;
    return hit.name.slice(base.length) + (hit.is_dir ? '/' : '');
  } catch {
    return null; // Unreadable directory and similar: degrade silently.
  }
}

/** AI-enhanced completion: only when the local tier found nothing and a key is configured; the model must return a full command starting with the prefix. */
export async function aiComplete(
  prefix: string,
  opts: CompleteOptions,
  signal?: AbortSignal,
): Promise<string | null> {
  if (!isApiKeyConfigured()) return null;
  const settings = useAgentSettings.getState().resolve();
  const active = activeModelProfile();
  const recent = useHistoryStore.getState().entries.filter(e => e.exitCode === null || e.exitCode === 0).slice(0, 5).map((e) => e.command);
  try {
    const model = createChatModel({
      provider: active.provider,
      baseUrl: active.baseUrl,
      model: settings.completeModel || active.model,
    });
    const { text } = await generateText({
      model,
      abortSignal: signal,
      prompt: [
        'Complete the shell command prefix. Return only one complete command line, without explanations or surrounding quotes.',
        opts.cwd ? `Current directory: ${opts.cwd}` : '',
        recent.length ? `Recent commands:\n${recent.join('\n')}` : '',
        `Input prefix: ${prefix}`,
      ]
        .filter(Boolean)
        .join('\n'),
    });
    if (signal?.aborted) return null;
    const line = (text.split('\n')[0] ?? '').trim();
    if (line.startsWith(prefix) && line.length > prefix.length) return line.slice(prefix.length);
    return null;
  } catch {
    return null; // Network/abort/parse failure: stay silent.
  }
}

/** Full chain: local history → path → AI enhancement; returns the suffix or null. */
export async function completeCommand(
  prefix: string,
  opts: CompleteOptions,
  signal?: AbortSignal,
): Promise<string | null> {
  const local = localComplete(prefix);
  if (local) return local;
  const path = await pathComplete(prefix, opts.cwd, signal);
  if (path) return path;
  if (signal?.aborted) return null;
  return aiComplete(prefix, opts, signal);
}
