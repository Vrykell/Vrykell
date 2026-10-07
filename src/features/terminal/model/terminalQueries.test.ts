import { describe, it, expect } from 'vitest';
import { querySequences } from '@features/terminal/model/terminalQueries';

describe('querySequences', () => {
  it('lists the questions a program asks', () => {
    expect(querySequences('\x1b[?u')).toEqual(['\x1b[?u']);
    expect(querySequences('\x1b[c')).toEqual(['\x1b[c']);
    expect(querySequences('\x1b[>0q')).toEqual(['\x1b[>0q']);
    expect(querySequences('\x1b[?2026$p')).toEqual(['\x1b[?2026$p']);
    expect(querySequences('\x1b[6n')).toEqual(['\x1b[6n']);
    expect(querySequences('\x1b]11;?')).toEqual(['\x1b]11;?']);
  });

  it('ignores output that asks nothing', () => {
    expect(querySequences('hello \x1b[32mworld\x1b[0m')).toEqual([]);
    expect(querySequences('\x1b[?25l\x1b[?25h\x1b[2J\x1b[H')).toEqual([]);
    expect(querySequences('\x1b]0;title\x07')).toEqual([]);
  });

  it('reports each question once per chunk', () => {
    expect(querySequences('\x1b[?u and \x1b[?u again')).toEqual(['\x1b[?u']);
    expect(querySequences('\x1b[c\x1b[?u')).toEqual(['\x1b[c', '\x1b[?u']);
  });
});
