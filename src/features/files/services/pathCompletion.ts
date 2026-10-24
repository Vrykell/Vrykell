import type { FileOps } from '../model/fileOps';

export interface PathCompletion {
  text: string;
  cursor: number;
}

export interface PathToken {
  start: number;
  value: string;
  quote: string;
  closed: boolean;
  windows: boolean;
  powershell: boolean;
  directoriesOnly: boolean;
}

export function pathCompletionToken(text: string, cursor: number, shell?: string): PathToken | null {
  if (text.includes('\n') || cursor < 0 || cursor > text.length || text[cursor] && !/\s/.test(text[cursor]!)) return null;
  const windows = shell === 'cmd' || shell === 'pwsh' || shell === 'powershell';
  const powershell = shell === 'pwsh' || shell === 'powershell';
  const escape = powershell ? '`' : windows ? '' : '\\';
  let start = 0;
  let quote = '';
  let value = '';
  let firstQuote = '';
  let closed = false;
  for (let index = 0; index < cursor; index++) {
    const character = text[index]!;
    if (escape && character === escape && quote !== "'" && index + 1 < cursor) { value += text[++index]; continue; }
    if (quote) {
      if (character === quote) {
        if (powershell && quote === "'" && text[index + 1] === "'") { value += "'"; index++; }
        else { quote = ''; closed = true; }
      } else value += character;
    } else if (character === '"' || character === "'" && shell !== 'cmd') {
      quote = character;
      if (index === start) firstQuote = character;
    } else if (/\s/.test(character) || '|;&<>'.includes(character)) {
      start = index + 1; value = ''; firstQuote = ''; closed = false;
    } else value += character;
  }
  const before = text.slice(0, start).trim();
  if (!before && !/[/.\\~]/.test(value) || value.startsWith('-') || /[$\x00-\x1f]/.test(value)
    || !powershell && value.includes('`') || shell === 'cmd' && value.includes('%')) return null;
  const command = before.split(/[|;&]/).pop()?.trim().split(/\s+/)[0]?.toLowerCase();
  return { start, value, quote: firstQuote, closed, windows, powershell,
    directoriesOnly: command === 'cd' || command === 'chdir' || command === 'set-location' || command === 'pushd' };
}

function quotePath(value: string, token: PathToken, directory: boolean): string {
  if (token.quote) {
    const escaped = token.quote === "'" ? value.replace(/'/g, token.powershell ? "''" : "'\\''")
      : value.replace(token.windows ? /["`$]/g : /[\\"`$]/g, character => `${token.powershell ? '`' : token.windows ? '' : '\\'}${character}`);
    return token.quote + escaped + (token.closed || !directory ? token.quote : '');
  }
  if (token.windows && !token.powershell) return /[\s&|<>()^]/.test(value) ? `"${value}"` : value;
  return value.replace(token.powershell ? /[\s"'`$&;|<>()*?!#{}\[\]]/g : /[\s\\"'`$&;|<>()*?!#{}\[\]]/g,
    character => `${token.powershell ? '`' : '\\'}${character}`);
}

export async function completeFilePath(text: string, cursor: number, token: PathToken, cwd: string | undefined, ops: Pick<FileOps, 'home' | 'list' | 'join'>): Promise<PathCompletion[]> {
  const separator = token.windows && token.value.includes('\\') ? '\\' : '/';
  const value = token.windows ? token.value.replace(/\\/g, '/') : token.value;
  const slash = value.lastIndexOf('/');
  let prefix = slash < 0 ? '' : value.slice(0, slash + 1);
  let name = value.slice(slash + 1);
  if (value === '~') { prefix = '~/'; name = ''; }
  let directory: string | null;
  if (prefix.startsWith('~/')) {
    const home = ops.home ? await ops.home() : (await ops.list(null)).base;
    if (!home) return [];
    directory = ops.join(home, prefix.slice(2));
    prefix = directory.endsWith('/') ? directory : `${directory}/`;
  } else if (prefix.startsWith('/') || /^[a-z]:\//i.test(prefix)) directory = prefix;
  else if (cwd) directory = prefix ? ops.join(cwd, prefix) : cwd;
  else return [];
  const entries = (await ops.list(directory)).entries;
  const matches = entries.filter(entry => !/[\x00-\x1f\x7f]/.test(entry.name) && !(token.windows && !token.powershell && /["%!]/.test(entry.name))
    && (!token.directoriesOnly || entry.is_dir)
    && (token.windows ? entry.name.toLowerCase().startsWith(name.toLowerCase()) : entry.name.startsWith(name)))
    .sort((first, second) => Number(second.is_dir) - Number(first.is_dir) || first.name.localeCompare(second.name));
  return matches.slice(0, 200).map(entry => {
    const path = `${prefix}${entry.name}${entry.is_dir ? '/' : ''}`;
    const completed = quotePath(token.windows ? path.replace(/\//g, separator) : path, token, entry.is_dir);
    return { text: text.slice(0, token.start) + completed + text.slice(cursor), cursor: token.start + completed.length };
  });
}
