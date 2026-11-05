import { expect, it, vi } from 'vitest';
import { flushEditorChanges, registerEditorChangeFlush } from '@ui/editor/code/pendingChanges';

it('flushes every pending editor and forgets an unregistered one', () => {
  const first = vi.fn();
  const second = vi.fn();
  const stopFirst = registerEditorChangeFlush(first);
  const stopSecond = registerEditorChangeFlush(second);
  flushEditorChanges();
  expect(first).toHaveBeenCalledOnce();
  expect(second).toHaveBeenCalledOnce();
  stopFirst();
  flushEditorChanges();
  expect(first).toHaveBeenCalledOnce();
  expect(second).toHaveBeenCalledTimes(2);
  stopSecond();
});
