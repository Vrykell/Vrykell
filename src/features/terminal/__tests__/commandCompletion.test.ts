import { afterEach, expect, it } from 'vitest';
import { Terminal } from '@xterm/xterm';
import { registerTerminal, unregisterTerminal, useTerminalStore } from '../stores/terminal';
import { terminalCommandReady } from '@features/agent/services/terminalAvailability';
import {
  clearCompletionReadiness,
  completionRecoveryReady,
  retainCompletionForReadiness,
  watchShellCommandCompletion,
} from '../services/commandCompletion';

const initialTerm = useTerminalStore.getState();
const instances: Terminal[] = [];
afterEach(() => {
  clearCompletionReadiness('completion-test');
  for (const terminal of instances.splice(0)) { unregisterTerminal('completion-test', terminal); terminal.dispose(); }
  useTerminalStore.setState(initialTerm, true);
});

function setup(scrollback = 1000, cols = 80) {
  const terminal = new Terminal({ cols, rows: 5, scrollback });
  instances.push(terminal); registerTerminal('completion-test', terminal);
  const completion = watchShellCommandCompletion('completion-test')!;
  const command = completion.wrap("printf '%s' 'a quote: it\'s here'");
  const token = /777;([^;]+);/.exec(command)![1];
  const write = (data: string) => new Promise<void>(resolve => terminal.write(data, resolve));
  return { terminal, completion, command, token, write };
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

it('drops the echoed wrapper left on the marker row when the shell returns with a carriage return', async () => {
  const { completion, token, command, write } = setup(1000, 30);
  const wrapper = command.replace('\n', '');
  await write(`prompt> ${wrapper}\r`);
  await write(`\x1b]777;${token};start\x07hello\r\n\x1b]777;${token};0\x07`);
  expect(completion.result()).toEqual({ exitCode: 0, output: 'hello' });
  completion.dispose();
});

it('retains a late completion marker as the pane readiness signal', async () => {
  const { completion, token, write } = setup();
  retainCompletionForReadiness('completion-test', completion);
  expect(completionRecoveryReady('completion-test')).toBe(false);

  await write(`\x1b]777;${token};start\x07done\x1b]777;${token};0\x07`);
  expect(completionRecoveryReady('completion-test')).toBe(true);

  clearCompletionReadiness('completion-test');
  expect(completionRecoveryReady('completion-test')).toBe(false);
});

it('drops retained readiness as soon as the user types in the pane', async () => {
  const { terminal, completion, token, write } = setup();
  useTerminalStore.setState((state) => ({
    sessions: { ...state.sessions, 'completion-test': 'pty-test' },
    startupStates: { ...state.startupStates, 'completion-test': 'ready' },
    scenes: { ...state.scenes, 'completion-test': 'classic' },
  }));
  retainCompletionForReadiness('completion-test', completion);
  await write(`\x1b]777;${token};start\x07done\x1b]777;${token};0\x07`);
  expect(completionRecoveryReady('completion-test')).toBe(true);
  expect(terminalCommandReady('completion-test')).toBe(true);

  terminal.input('l', true);

  expect(completionRecoveryReady('completion-test')).toBe(false);
  expect(terminalCommandReady('completion-test')).toBe(false);
});

it('keeps real output that ends with the same text as the echoed wrapper tail', async () => {
  const { completion, token, write } = setup(1000, 120);
  const echoed = 'prompt> echoed wrapper command tail';
  // The shell echoed the wrapper without a newline; the marker sits at the end of that echo.
  await write(echoed);
  await write(`\x1b]777;${token};start\x07`);
  const real = `real output ${echoed}`;
  await write(`${real}\r\n\x1b]777;${token};0\x07`);
  expect(completion.result()).toEqual({ exitCode: 0, output: real });
  completion.dispose();
});

it('keeps output that matches only a short suffix of the echoed wrapper', async () => {
  const { completion, token, write } = setup(1000, 120);
  await write('abcdefghijklmnopqrstuvwxyz\r');
  await write(`\x1b]777;${token};start\x07`);
  const real = '0123456789RESULT-abcdefghij';
  await write(`${real}\r\n\x1b]777;${token};0\x07`);
  expect(completion.result()).toEqual({ exitCode: 0, output: real });
  completion.dispose();
});

it('forgets retained readiness when the pane receives a new terminal', async () => {
  const { completion, token, write } = setup();
  retainCompletionForReadiness('completion-test', completion);
  await write(`\x1b]777;${token};start\x07done\x1b]777;${token};0\x07`);
  expect(completionRecoveryReady('completion-test')).toBe(true);

  const replacement = new Terminal({ cols: 80, rows: 5, scrollback: 100 });
  instances.push(replacement); registerTerminal('completion-test', replacement);
  expect(completionRecoveryReady('completion-test')).toBe(false);
});
