/**
 * blocks — command block store tests.
 */
import { describe, it, expect } from 'vitest';
import type { TermBlock } from '../services/pipeline/termBlock';
import { useBlockStore, selectBlocks } from '@features/terminal/stores/blocks';

const mk = (id: string): TermBlock =>
  ({ id, command: '', status: 'done', exitCode: 0, startedAt: 1, endedAt: 2, cwd: '', outputHtml: '', outputText: '', outputRaw: '', linesTruncated: 0, wasLongRunning: false });

describe('blocks store', () => {
  it('addBlock / updateBlock / setBlocks / clearBlocks / dropTab', () => {
    useBlockStore.setState({ byTab: {} });
    const s = useBlockStore.getState();
    s.addBlock('t1', mk('b1'));
    s.addBlock('t1', mk('b2'));
    expect(useBlockStore.getState().byTab.t1).toHaveLength(2);
    s.updateBlock('t1', 'b1', { exitCode: 1 });
    expect(useBlockStore.getState().byTab.t1[0]!.exitCode).toBe(1);
    s.setBlocks('t1', [mk('b3')]);
    expect(useBlockStore.getState().byTab.t1).toHaveLength(1);
    s.clearBlocks('t1');
    expect(useBlockStore.getState().byTab.t1).toEqual([]);
    s.addBlock('t1', mk('b4'));
    s.dropTab('t1');
    expect(useBlockStore.getState().byTab.t1).toBeUndefined();
  });

  it('missing tab / block: every operation is safe and has no side effects', () => {
    useBlockStore.setState({ byTab: {} });
    const s = useBlockStore.getState();
    s.addBlock('t1', mk('b1'));
    const before = useBlockStore.getState().byTab;
    s.updateBlock('nope', 'b1', { exitCode: 9 });
    s.dropTab('nope');
    expect(useBlockStore.getState().byTab).toEqual(before);
  });

  it('selectBlocks: a missing tab returns a stable empty reference', () => {
    useBlockStore.setState({ byTab: { t1: [mk('b1')] } });
    const state = useBlockStore.getState;
    const sel = selectBlocks('t1');
    expect(sel(state())).toHaveLength(1);
    const missing = selectBlocks('nope');
    expect(missing(state())).toEqual([]);
    expect(selectBlocks('nope')(state())).toBe(missing(state()));
  });
});
