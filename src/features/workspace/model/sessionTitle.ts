/**
 * Session tab title model.
 *
 * A title has a source, and the source decides which later assignment may replace it: a manual
 * name wins over everything, an AI name may refresh any generated title, and the first command or
 * message only fills (or upgrades) a generated one. The live title a running program sets via
 * OSC 0/2 is rendered on top of the stored title but is never persisted and never becomes a
 * source of its own.
 */

export type TitleSource = 'manual' | 'ai' | 'command' | 'message';

/** Cap for an AI-generated title. */
export const MAX_TITLE_LEN = 16;
/** Cap for a command-derived title. */
export const COMMAND_TITLE_LEN = 24;
/** Cap for a first-message title. */
export const MESSAGE_TITLE_LEN = 14;

const SOURCE_PRIORITY: Record<TitleSource, number> = {
  command: 1,
  message: 2,
  ai: 3,
  manual: 4,
};

/**
 * Whether a title from `incoming` may replace the tab's current title source.
 *
 * A manual name is terminal. An AI title may refresh anything generated (so a retitle keeps
 * improving), while a command or message only fills the default title or upgrades a
 * lower-priority generated one; equal priorities never overwrite (the first signal wins).
 */
export function canApplyTitle(current: TitleSource | undefined, incoming: TitleSource): boolean {
  if (incoming === 'manual') return true;
  if (current === 'manual') return false;
  if (incoming === 'ai') return true;
  if (current === undefined) return true;
  return SOURCE_PRIORITY[incoming] > SOURCE_PRIORITY[current];
}

/** Trim quotes and line breaks, drop a trailing period, and cap the length. */
export function sanitizeTitle(raw: string): string {
  return raw
    .replace(/["'`「」『』《》\n\r\t]/g, '')
    .trim()
    .replace(/[。！？!?.…]+$/u, '')
    .slice(0, MAX_TITLE_LEN)
    .trim();
}

/** Clip a title to `max` characters with an ellipsis. */
export function truncateTitle(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Commands that say nothing about the task, so a first-command title skips them. */
const NOISE_COMMANDS = new Set([
  'ls', 'll', 'la', 'cd', 'pwd', 'clear', 'cls', 'history', 'exit', 'logout', 'echo', 'cat',
  'less', 'more', 'head', 'tail', 'which', 'where', 'man', 'help', 'true', 'false', 'env',
  'export', 'set', 'unset', 'source', 'alias', 'sleep',
]);

/**
 * Reduce a command line to a short label: the program plus up to two subcommand words, with
 * flags, arguments and leading `VAR=value` assignments dropped. Noise commands yield `''` so the
 * caller can wait for a meaningful one.
 */
export function normalizeCommandForTitle(command: string): string {
  const firstLine = command.split('\n', 1)[0]?.trim() ?? '';
  if (!firstLine) return '';
  const tokens = firstLine.split(/\s+/);
  let start = 0;
  while (start < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[start]!)) start += 1;
  const words = tokens.slice(start).filter((token) => !token.startsWith('-'));
  const program = words[0]?.replace(/^.*[/\\]/, '') ?? '';
  if (!program || NOISE_COMMANDS.has(program)) return '';
  const label = [program];
  for (const word of words.slice(1)) {
    if (label.length >= 3) break;
    if (word.includes('/') || /["'`]/.test(word)) break;
    label.push(word);
  }
  return label.join(' ');
}

/**
 * Effective title to render for a tab: a running program's live title wins over the stored
 * generated title, but a manual name is never replaced.
 */
export function resolveDisplayTitle(
  storedTitle: string,
  source: TitleSource | undefined,
  programTitle: string,
): string {
  if (source === 'manual') return storedTitle;
  return programTitle.trim() || storedTitle;
}
