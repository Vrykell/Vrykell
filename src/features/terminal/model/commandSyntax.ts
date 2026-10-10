export type CommandTokenKind = 'plain' | 'command' | 'flag' | 'path' | 'string' | 'variable' | 'operator' | 'comment';
export interface CommandToken { text: string; kind: CommandTokenKind }

/** Classify command text for display only; never execute or parse terminal output. */
export function tokenizeCommand(source: string): CommandToken[] {
  const tokens: CommandToken[] = [];
  let index = 0;
  let expectsCommand = true;
  while (index < source.length) {
    const start = index;
    const character = source[index]!;
    let kind: CommandTokenKind = 'plain';
    if (/\s/.test(character)) {
      while (index < source.length && /\s/.test(source[index]!)) {
        if (source[index] === '\n') expectsCommand = true;
        index++;
      }
    } else if (character === '#') {
      kind = 'comment';
      while (index < source.length && source[index] !== '\n') index++;
    } else if ('|&;<>'.includes(character)) {
      kind = 'operator';
      while (index < source.length && '|&;<>'.includes(source[index]!)) index++;
      if ('|&;'.includes(character)) expectsCommand = true;
    } else if (character === '"' || character === "'") {
      kind = 'string';
      const quote = source[index++];
      while (index < source.length) {
        const next = source[index++];
        if (next === quote) break;
        if (next === '\\' && quote === '"' && index < source.length) index++;
      }
      expectsCommand = false;
    } else {
      while (index < source.length && !/\s/.test(source[index]!) && !'|&;<>'.includes(source[index]!)) {
        if (source[index] === '\\' && index + 1 < source.length) index++;
        index++;
      }
      const word = source.slice(start, index);
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) kind = 'variable';
      else if (expectsCommand) { kind = 'command'; expectsCommand = false; }
      else if (word.startsWith('$') || (word.startsWith('%') && word.endsWith('%'))) kind = 'variable';
      else if (word.startsWith('-')) kind = 'flag';
      else if (/^(?:~?[\\/]|\.\.?[\\/]|[A-Za-z]:[\\/])/.test(word)) kind = 'path';
    }
    tokens.push({ text: source.slice(start, index), kind });
  }
  return tokens;
}
