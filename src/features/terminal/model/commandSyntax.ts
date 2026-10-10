export type CommandTokenKind = 'plain' | 'command' | 'argument' | 'number' | 'keyword' | 'flag' | 'path' | 'string' | 'variable' | 'operator' | 'comment';
export interface CommandToken { text: string; kind: CommandTokenKind }

const KEYWORDS = new Set(['if', 'then', 'else', 'elif', 'fi', 'for', 'in', 'while', 'until', 'do', 'done', 'case', 'esac', 'function', 'select', 'time', '!']);
const WRAPPERS = new Set(['sudo', 'env', 'command', 'exec', 'nohup']);
const OPERATORS = '|&;<>()[{}]';

/** Classify editable shell text only, preserving every character and incomplete expression. */
export function tokenizeCommand(source: string): CommandToken[] {
  const tokens: CommandToken[] = [];
  let index = 0;
  const push = (start: number, kind: CommandTokenKind) => {
    const text = source.slice(start, index);
    if (!text) return;
    const previous = tokens[tokens.length - 1];
    if (previous?.kind === kind) previous.text += text;
    else tokens.push({ text, kind });
  };
  const boundary = (character: string) => /\s/.test(character) || OPERATORS.includes(character);
  const classify = (word: string, fallback: CommandTokenKind): CommandTokenKind => {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word) || /^%[^%]+%$/.test(word)) return 'variable';
    if (KEYWORDS.has(word)) return 'keyword';
    if (word.startsWith('-') && !/^-?\d/.test(word)) return 'flag';
    if (fallback === 'command') return 'command';
    if (/^-?(?:\d+(?:\.\d+)?|0x[\da-f]+)$/.test(word)) return 'number';
    if (word.includes('/') || word.includes('\\') || word === '~' || /\.[A-Za-z\d]+$/.test(word)) return 'path';
    return fallback;
  };
  const variable = (depth: number) => {
    const start = index++;
    if (source[index] === '(' && depth < 32) {
      index++;
      push(start, 'operator');
      scan(')', depth + 1);
    } else if (source[index] === '{') {
      let braces = 1;
      index++;
      while (index < source.length && braces > 0) {
        if (source[index] === '{') braces++;
        if (source[index++] === '}') braces--;
      }
      push(start, 'variable');
    } else {
      if (/[\d?@*#$!-]/.test(source[index] ?? '')) index++;
      else while (index < source.length && /[A-Za-z\d_]/.test(source[index]!)) index++;
      push(start, 'variable');
    }
  };
  const quote = (depth: number) => {
    let start = index;
    const delimiter = source[index++];
    while (index < source.length) {
      const character = source[index]!;
      if (character === delimiter) { index++; break; }
      if (delimiter === '"' && character === '\\') { index = Math.min(source.length, index + 2); continue; }
      if (delimiter === '"' && (character === '$' || character === '`')) {
        push(start, 'string');
        if (character === '$') variable(depth);
        else substitution(depth);
        start = index;
      } else index++;
    }
    push(start, 'string');
  };
  const substitution = (depth: number) => {
    const start = index++;
    push(start, 'operator');
    if (depth < 32) scan('`', depth + 1);
  };
  const word = (fallback: CommandTokenKind, depth: number, stop: string) => {
    while (index < source.length && !boundary(source[index]!) && source[index] !== stop) {
      if (source[index] === '"' || source[index] === "'") quote(depth);
      else if (source[index] === '$') variable(depth);
      else if (source[index] === '`') substitution(depth);
      else {
        const start = index;
        while (index < source.length && !boundary(source[index]!) && source[index] !== stop && !'"\'$`'.includes(source[index]!)) {
          if (source[index] === '\\' && index + 1 < source.length) index++;
          index++;
        }
        push(start, classify(source.slice(start, index), fallback));
      }
    }
  };
  const scan = (stop = '', depth = 0) => {
    let expectsCommand = true;
    let redirectTarget = false;
    while (index < source.length) {
      const start = index;
      const character = source[index]!;
      if (stop && character === stop) { index++; push(start, 'operator'); return; }
      if (/\s/.test(character)) {
        while (index < source.length && /\s/.test(source[index]!)) {
          if (source[index] === '\n') expectsCommand = true;
          index++;
        }
        push(start, 'plain');
      } else if (character === '#') {
        while (index < source.length && source[index] !== '\n') index++;
        push(start, 'comment');
      } else if (OPERATORS.includes(character)) {
        index++;
        while (index < source.length && '|&;<>'.includes(character) && source[index] === character) index++;
        push(start, 'operator');
        redirectTarget = '<>'.includes(character);
        if ('|&;({'.includes(character)) expectsCommand = true;
      } else {
        word(redirectTarget ? 'path' : expectsCommand ? 'command' : 'argument', depth, stop);
        const value = source.slice(start, index);
        if (!redirectTarget && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(value) && !value.startsWith('-')) {
          expectsCommand = WRAPPERS.has(value) || ['then', 'else', 'elif', 'do', 'if', 'while', 'until', 'time', '!'].includes(value);
        }
        redirectTarget = false;
      }
    }
  };
  scan();
  return tokens;
}
