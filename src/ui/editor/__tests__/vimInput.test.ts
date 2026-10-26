import { afterEach, expect, it } from 'vitest';
import { replayVimText, type VimKeyEvent } from '@ui/editor/code/vimInput';

afterEach(() => { document.body.replaceChildren(); });

function keys() {
  const pressed: string[] = [];
  const label = (event: VimKeyEvent) => event.key.startsWith("'") ? event.key.slice(1, -1) : event.key;
  return { pressed, label, adapter: { handleKeyDown: (event: VimKeyEvent) => { pressed.push(label(event)); } } };
}

it('replays ordinary characters and special keys through the modal key handler', () => {
  const { pressed, adapter } = keys();
  replayVimText(adapter, null, 'ab\n');
  expect(pressed).toEqual(['a', 'b', 'Enter']);
});

it('opens the command prompt with the first key and appends the remaining text', () => {
  const { pressed, adapter } = keys();
  const statusBar = document.createElement('div');
  document.body.append(statusBar);
  const prompt = document.createElement('input');
  adapter.handleKeyDown = event => {
    pressed.push(event.browserEvent.key);
    if (event.browserEvent.key === ':') {
      statusBar.append(prompt);
      prompt.focus();
    }
  };
  replayVimText(adapter, statusBar, ':w');
  expect(pressed).toEqual([':']);
  expect(prompt.value).toBe('w');
});

it('submits a command when the composition ends with a newline', () => {
  const { adapter } = keys();
  const statusBar = document.createElement('div');
  document.body.append(statusBar);
  const prompt = document.createElement('input');
  let submitted = false;
  prompt.addEventListener('keydown', event => { if (event.keyCode === 13) submitted = true; });
  adapter.handleKeyDown = event => {
    if (event.browserEvent.key === ':') {
      statusBar.append(prompt);
      prompt.focus();
    }
  };
  replayVimText(adapter, statusBar, ':w\n');
  expect(prompt.value).toBe('w');
  expect(submitted).toBe(true);
});

it('fills a search prompt and lets its key-up handler see the committed text', () => {
  const { adapter } = keys();
  const statusBar = document.createElement('div');
  document.body.append(statusBar);
  const prompt = document.createElement('input');
  const seen: string[] = [];
  prompt.addEventListener('input', () => seen.push('input'));
  prompt.addEventListener('keyup', () => seen.push('keyup'));
  adapter.handleKeyDown = event => {
    if (event.browserEvent.key === '/') {
      statusBar.append(prompt);
      prompt.focus();
    }
  };
  replayVimText(adapter, statusBar, '/你好');
  expect(prompt.value).toBe('你好');
  expect(seen).toEqual(['input', 'keyup']);
});
