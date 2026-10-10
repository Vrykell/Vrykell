import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import CommandSyntax from '../../components/CommandSyntax';
import { tokenizeCommand } from '../commandSyntax';

describe('command syntax presentation', () => {
  it('colors commands after assignments and pipelines, plus arguments and comments', () => {
    const source = 'LANG=en npm list --json | grep "中文目录" > ./result # note';
    const tokens = tokenizeCommand(source);
    expect(tokens.map(token => token.text).join('')).toBe(source);
    expect(tokens.filter(token => token.kind !== 'plain')).toEqual([
      { text: 'LANG=en', kind: 'variable' }, { text: 'npm', kind: 'command' },
      { text: 'list', kind: 'argument' }, { text: '--json', kind: 'flag' }, { text: '|', kind: 'operator' },
      { text: 'grep', kind: 'command' }, { text: '"中文目录"', kind: 'string' },
      { text: '>', kind: 'operator' }, { text: './result', kind: 'path' },
      { text: '# note', kind: 'comment' },
    ]);
  });

  it.each(['', 'echo "unfinished', "echo 'a b'\npwd", 'cat ./a\\ b $HOME', 'dir C:\\Users\\dev %TEMP%', 'echo 😃'])('preserves every character of %j', source => {
    expect(tokenizeCommand(source).map(token => token.text).join('')).toBe(source);
  });


  it('colors subcommands, ordinary arguments, numbers and relative paths without plain text gaps', () => {
    const source = 'git switch feature/demo && npm run build --timeout 30 config.json';
    const tokens = tokenizeCommand(source);
    expect(tokens.filter(token => token.kind === 'plain').every(token => /^\s+$/.test(token.text))).toBe(true);
    expect(tokens).toContainEqual({ text: 'switch', kind: 'argument' });
    expect(tokens).toContainEqual({ text: 'feature/demo', kind: 'path' });
    expect(tokens).toContainEqual({ text: '30', kind: 'number' });
    expect(tokens).toContainEqual({ text: 'config.json', kind: 'path' });
    expect(tokens.map(token => token.text).join('')).toBe(source);
  });

  it('colors variables within quotes and nested command substitutions independently', () => {
    const source = 'echo "home=$HOME name=$(basename \"$_FILE\")" `pwd`';
    const tokens = tokenizeCommand(source);
    expect(tokens.filter(token => token.kind === 'command').map(token => token.text)).toEqual(['echo', 'basename', 'pwd']);
    expect(tokens.filter(token => token.kind === 'variable').map(token => token.text)).toEqual(['$HOME', '$_FILE']);
    expect(tokens.map(token => token.text).join('')).toBe(source);
  });

  it('retains the real command after assignments, wrappers and output redirection', () => {
    const tokens = tokenizeCommand('LANG="zh_CN" sudo -E env DEBUG=1 npm list > report');
    expect(tokens.filter(token => token.kind === 'command').map(token => token.text)).toEqual(['sudo', 'env', 'npm']);
    expect(tokens).toContainEqual({ text: 'report', kind: 'path' });
    expect(tokens).toContainEqual({ text: 'list', kind: 'argument' });
  });

  it.each(['echo \"$HOME $(git branch --show-current)\"', 'echo \`pwd\`', 'echo $(echo $(pwd))', 'echo ${HOME:-~/tmp}', 'echo --name=\"a b\"', 'echo \"unfinished $VAR', 'printf \"%s\" \\$HOME', 'for file in *.ts; do echo \"$file\"; done'])('preserves nested and incomplete syntax %j', source => {
    const tokens = tokenizeCommand(source);
    expect(tokens.map(token => token.text).join('')).toBe(source);
    expect(tokens.filter(token => token.kind === 'plain').every(token => /^\s+$/.test(token.text))).toBe(true);
  });

  it('renders command markup as text without injecting elements', () => {
    const source = 'echo "<img src=x onerror=alert(1)>"';
    const { container } = render(<CommandSyntax text={source} />);
    expect(container.textContent).toBe(source);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[data-kind="command"]')).toHaveTextContent('echo');
  });
});
