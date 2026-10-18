import { beforeEach, expect, it } from 'vitest';
import { COMMAND_COLLAPSE_KEY, readCommandCollapse, writeCommandCollapse } from '../model/collapse';

beforeEach(() => { localStorage.clear(); });

it('round-trips the folded layout and degrades corrupt payloads to an expanded panel', () => {
  expect(readCommandCollapse()).toEqual(new Set());
  writeCommandCollapse(new Set(['favorites', 'release']));
  expect(readCommandCollapse()).toEqual(new Set(['favorites', 'release']));
  localStorage.setItem(COMMAND_COLLAPSE_KEY, '{oops');
  expect(readCommandCollapse()).toEqual(new Set());
  localStorage.setItem(COMMAND_COLLAPSE_KEY, JSON.stringify(['favorites', 7, null, '']));
  expect(readCommandCollapse()).toEqual(new Set(['favorites']));
});
