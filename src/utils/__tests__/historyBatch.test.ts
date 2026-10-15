import { expect, it } from 'vitest';
import { runHistoryBatch } from '../historyBatch';

it('processes each record in order, retains failures and continues after an individual failure', async () => {
  const order: string[] = [];
  const result = await runHistoryBatch([{ id: 'a' }, { id: 'b' }, { id: 'a' }, { id: 'c' }], async item => {
    order.push(item.id);
    if (item.id === 'b') throw new Error('Unavailable');
  });
  expect(order).toEqual(['a', 'b', 'c']);
  expect(result.succeeded.map(item => item.id)).toEqual(['a', 'c']);
  expect(result.failed.map(item => item.id)).toEqual(['b']);
});
