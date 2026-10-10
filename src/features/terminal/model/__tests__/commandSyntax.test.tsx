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
      { text: '--json', kind: 'flag' }, { text: '|', kind: 'operator' },
      { text: 'grep', kind: 'command' }, { text: '"中文目录"', kind: 'string' },
      { text: '>', kind: 'operator' }, { text: './result', kind: 'path' },
      { text: '# note', kind: 'comment' },
    ]);
  });

  it.each(['', 'echo "unfinished', "echo 'a b'\npwd", 'cat ./a\\ b $HOME', 'dir C:\\Users\\dev %TEMP%', 'echo 😃'])('preserves every character of %j', source => {
    expect(tokenizeCommand(source).map(token => token.text).join('')).toBe(source);
  });

  it('renders command markup as text without injecting elements', () => {
    const source = 'echo "<img src=x onerror=alert(1)>"';
    const { container } = render(<CommandSyntax text={source} />);
    expect(container.textContent).toBe(source);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[data-kind="command"]')).toHaveTextContent('echo');
  });
});
