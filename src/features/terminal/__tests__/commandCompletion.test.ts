import { afterEach, expect, it } from 'vitest';
import { Terminal } from '@xterm/xterm';
import { registerTerminal, unregisterTerminal } from '../stores/terminal';
import { watchShellCommandCompletion } from '../services/commandCompletion';

const instances: Terminal[] = [];
afterEach(() => { for (const terminal of instances.splice(0)) { unregisterTerminal('completion-test', terminal); terminal.dispose(); } });

function setup(scrollback = 1000) {
  const terminal = new Terminal({ cols: 80, rows: 5, scrollback });
  instances.push(terminal); registerTerminal('completion-test', terminal);
  const completion = watchShellCommandCompletion('completion-test')!;
  const command = completion.wrap("printf '%s' 'a quote: it\'s here'");
  const token = /777;([^;]+);/.exec(command)![1];
  const write = (data: string) => new Promise<void>(resolve => terminal.write(data, resolve));
  return { terminal, completion, token, write };
}

it('reads only command output using the actual terminal parser, excluding prompt and echoed wrapper', async () => {
  const { completion, token, write } = setup();
  await write('old output\r\nprompt> echoed command wrapper\r\n');
  await write(`\x1b]777;${token};start\x07first line\r\nsecond line\x1b]777;${token};2\x07`);
  expect(completion.result()).toEqual({ exitCode: 2, output: 'first line\nsecond line' });
  completion.dispose();
});

it('keeps the output tail when the command scrolls its starting marker out of the buffer', async () => {
  const { completion, token, write } = setup(5);
  await write(`\x1b]777;${token};start\x07`);
  await write(Array.from({ length: 30 }, (_, index) => `line ${index}\r\n`).join(''));
  await write(`\x1b]777;${token};0\x07`);
  expect(completion.result()?.output).toContain('line 29');
  expect(completion.result()?.output).not.toContain('line 0\n');
  completion.dispose();
});

it('quotes command literals without altering their content', () => {
  const { completion } = setup();
  const payload = completion.wrap("echo 'hello'; false\necho next");
  expect(payload.trimEnd()).not.toContain('\n');
  expect(payload).toContain("'echo '\\''hello'\\''; false' 'echo next'");
  completion.dispose();
});
