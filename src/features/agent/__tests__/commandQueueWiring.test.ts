import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useBlockStore } from '@features/terminal/stores/blocks';
import { useTerminalStore } from '@features/terminal/stores/terminal';
import { approvingToolContext } from '../../../test-utils/approvingToolContext';
import { usePermissions } from '../stores/permissions';
import { buildTools } from '../tools';

const runCommandAndWait = vi.hoisted(() => vi.fn());
vi.mock('@features/agent/tools/runCommand', () => ({ runCommandAndWait }));

const initialTerm = useTerminalStore.getState();
const initialBlocks = useBlockStore.getState();
const initialPermissions = usePermissions.getState();
const paneId = 'queue-wiring-pane';

type Run = { execute: (input: { command: string }, options: { toolCallId: string }) => Promise<Record<string, unknown>> };

function run(): Run['execute'] {
  const tools = buildTools(approvingToolContext({ paneId }));
  return (tools.run_command as unknown as Run).execute;
}

beforeEach(() => {
  runCommandAndWait.mockReset();
  usePermissions.setState({ levels: { run_command: 'allow' } });
  useTerminalStore.setState({
    sessions: { [paneId]: 'pty-wiring' },
    startupStates: { [paneId]: 'ready' },
    scenes: { [paneId]: 'blockList' },
  });
  useBlockStore.setState({ byTab: { [paneId]: [{ status: 'executing' } as never] } });
});

afterEach(() => {
  useTerminalStore.setState(initialTerm, true);
  useBlockStore.setState(initialBlocks, true);
  usePermissions.setState(initialPermissions, true);
});

it('wires the command queue readiness check to the captured terminal', async () => {
  runCommandAndWait
    .mockResolvedValueOnce({ ok: false, completed: false, output: '', code: 'COMMAND_TIMEOUT', error: 'Timed out' })
    .mockResolvedValueOnce({ ok: true, completed: true, output: 'recovered' });
  const execute = run();

  expect(await execute({ command: 'first' }, { toolCallId: 'first' })).toMatchObject({ code: 'COMMAND_TIMEOUT' });
  expect(await execute({ command: 'blocked' }, { toolCallId: 'blocked' })).toMatchObject({
    ok: false, completed: false, code: 'PREVIOUS_COMMAND_UNCONFIRMED',
  });
  expect(runCommandAndWait).toHaveBeenCalledOnce();

  useBlockStore.setState({ byTab: { [paneId]: [{ status: 'interrupted' } as never] } });
  expect(await execute({ command: 'recovered' }, { toolCallId: 'recovered' })).toMatchObject({ ok: true, output: 'recovered' });
  expect(runCommandAndWait).toHaveBeenCalledTimes(2);
});
