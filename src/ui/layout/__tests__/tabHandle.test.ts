import { expect, it } from 'vitest';
import { DEFAULT_TAB_CAPABILITIES, tabCapabilities } from '@ui/layout/tabHandle';

it('starts from the shared defaults and only overrides explicit capabilities', () => {
  expect(tabCapabilities()).toEqual({ renameable: false, groupable: false });
  expect(tabCapabilities({ groupable: true })).toEqual({ renameable: false, groupable: true });
  expect(tabCapabilities({ renameable: true })).toEqual({ renameable: true, groupable: false });
});

it('never mutates the frozen defaults', () => {
  expect(Object.isFrozen(DEFAULT_TAB_CAPABILITIES)).toBe(true);
  const first = tabCapabilities();
  first.groupable = true;
  expect(tabCapabilities().groupable).toBe(false);
});
