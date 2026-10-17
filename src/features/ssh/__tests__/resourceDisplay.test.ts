import { beforeEach, expect, it } from 'vitest';
import { readResourceDisplay, useResourceDisplay } from '../stores/resourceDisplay';

beforeEach(() => { localStorage.clear(); useResourceDisplay.setState({ display: 'bars' }); });

it('defaults to progress bars and validates stored display preferences', () => {
  expect(readResourceDisplay()).toBe('bars');
  localStorage.setItem('vrykell-ssh-resource-display', 'unknown');
  expect(readResourceDisplay()).toBe('bars');
  localStorage.setItem('vrykell-ssh-resource-display', 'chart');
  expect(readResourceDisplay()).toBe('chart');
});

it('shares and persists the selected presentation', () => {
  useResourceDisplay.getState().setDisplay('chart');
  expect(useResourceDisplay.getState().display).toBe('chart');
  expect(readResourceDisplay()).toBe('chart');
  useResourceDisplay.getState().setDisplay('bars');
  expect(readResourceDisplay()).toBe('bars');
});
