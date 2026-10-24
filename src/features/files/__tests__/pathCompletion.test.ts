import { describe, expect, it, vi } from 'vitest';
import { completeFilePath, pathCompletionToken } from '../services/pathCompletion';

const entries = [
  { name: 'src', path: '/work/src', is_dir: true },
  { name: 'readme.txt', path: '/work/readme.txt', is_dir: false },
  { name: 'release.txt', path: '/work/release.txt', is_dir: false },
  { name: 'my file.txt', path: '/work/my file.txt', is_dir: false },
  { name: 'Users', path: 'C:/Users', is_dir: true },
];
function setup() {
  const ops = { list: vi.fn(async () => ({ entries, base: '/home/test' })), home: vi.fn(async () => '/home/test'),
    join: (directory: string, name: string) => `${directory.replace(/\/$/, '')}/${name}` };
  const complete = (text: string, shell?: string, cursor = text.length) => completeFilePath(text, cursor, pathCompletionToken(text, cursor, shell)!, '/work', ops);
  return { ops, complete };
}

describe('file path completion', () => {
  it('leaves command names, flags, substitutions and incomplete cursor tokens alone', () => {
    for (const text of ['git', 'cat --file', 'cat $HOME', 'cat `pwd`', 'cat file\nother']) expect(pathCompletionToken(text, text.length)).toBeNull();
    expect(pathCompletionToken('cat readme', 6)).toBeNull();
    expect(pathCompletionToken('type %HOME%', 11, 'cmd')).toBeNull();
  });

  it('uses the supplied directory and preserves command suffixes', async () => {
    const { complete, ops } = setup();
    expect((await complete('cat re')).map(result => result.text)).toEqual(['cat readme.txt', 'cat release.txt']);
    expect(ops.list).toHaveBeenCalledWith('/work');
    expect((await complete('cat re | sort', undefined, 6))[0]).toEqual({ text: 'cat readme.txt | sort', cursor: 14 });
    await complete('cat ../re'); expect(ops.list).toHaveBeenLastCalledWith('/work/../');
  });

  it('filters directory commands and quotes spaces without executing shell expressions', async () => {
    const { complete } = setup();
    expect((await complete('cd -P ')).every(result => result.text.endsWith('/'))).toBe(true);
    expect((await complete('cat my'))[0]?.text).toBe('cat my\\ file.txt');
    expect((await complete('cat "my'))[0]?.text).toBe('cat "my file.txt"');
    expect((await complete('Get-Content my', 'pwsh'))[0]?.text).toBe('Get-Content my` file.txt');
  });

  it('preserves drive and backslash paths and resolves home before listing', async () => {
    const { complete, ops } = setup();
    expect((await complete('cd C:\\Us', 'cmd'))[0]?.text).toBe('cd C:\\Users\\');
    expect(ops.list).toHaveBeenLastCalledWith('C:/');
    expect((await complete('cat ~/re'))[0]?.text).toBe('cat /home/test/readme.txt');
    expect(ops.home).toHaveBeenCalledOnce();
    expect(ops.list).toHaveBeenLastCalledWith('/home/test/');
  });

  it('does not invent a directory if the terminal has not reported one', async () => {
    const { ops } = setup();
    expect(await completeFilePath('cat re', 6, pathCompletionToken('cat re', 6)!, undefined, ops)).toEqual([]);
    expect(ops.list).not.toHaveBeenCalled();
  });
});
