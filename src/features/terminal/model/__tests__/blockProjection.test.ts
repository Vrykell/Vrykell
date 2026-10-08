import { describe, expect, it } from 'vitest';
import { projectBlocks } from '../blockProjection';
import type { TermBlock } from '../../services/pipeline/termBlock';

const block: TermBlock = {
  id: 'history', command: 'ls', status: 'done', exitCode: 0, startedAt: 1, endedAt: 2,
  wasLongRunning: false, outputHtml: '', outputText: 'file', outputRaw: 'file', linesTruncated: 0,
};

describe('block projection', () => {
  it('preserves existing history references as new output arrives', () => {
    const previous = projectBlocks([block], [], () => false);
    const next = projectBlocks([block, { ...block, id: 'new' }], previous, () => false);
    expect(next[0]).toBe(previous[0]);
    expect(projectBlocks([block], previous, () => false)).toBe(previous);
  });

  it('invalidates modified output, truncation and agent markers without copying other history', () => {
    const previous = projectBlocks([block, { ...block, id: 'other' }], [], () => false);
    const next = projectBlocks([{ ...block, outputText: '', linesTruncated: 50 }, { ...block, id: 'other' }], previous, id => id === 'history');
    expect(next[0]).not.toBe(previous[0]);
    expect(next[0]).toMatchObject({ outputText: '', linesTruncated: 50, agent: true });
    expect(next[1]).toBe(previous[1]);
    expect(next[0]).not.toHaveProperty('outputTerm');
  });
});
