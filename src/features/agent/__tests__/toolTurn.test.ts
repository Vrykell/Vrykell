import { expect, it, vi } from 'vitest';
import { ToolTurn } from '../services/toolTurn';

it('does not start queued work after the active call refuses execution', async () => {
  const turn = new ToolTurn();
  let finish!: () => void;
  const execute = vi.fn();
  const first = turn.run(async () => {
    await new Promise<void>(resolve => { finish = resolve; });
    turn.observe('write_file', { denied: true });
    return 'denied';
  }, () => 'blocked');
  const queued = turn.run(() => { execute(); return 'executed'; }, () => 'blocked');
  await vi.waitFor(() => expect(finish).toBeDefined());
  expect(execute).not.toHaveBeenCalled();
  finish();
  expect(await first).toBe('denied');
  expect(await queued).toBe('blocked');
  expect(execute).not.toHaveBeenCalled();
});

it('preserves ordinary failure recovery and isolates another turn from an unanswered question', async () => {
  const turn = new ToolTurn();
  turn.observe('read_file', { ok: false, error: 'Missing file' });
  expect(await turn.run(() => 'retry', () => 'blocked')).toBe('retry');
  turn.observe('ask_user', { ok: true, answered: false });
  expect(await turn.run(() => 'execute', () => 'blocked')).toBe('blocked');
  expect(await new ToolTurn().run(() => 'new turn', () => 'blocked')).toBe('new turn');
});

it('cancels queued execution before it reaches authorization', async () => {
  const controller = new AbortController();
  const execute = vi.fn(() => 'executed');
  const queued = new ToolTurn().run(execute, () => 'cancelled', controller.signal);
  controller.abort();
  expect(await queued).toBe('cancelled');
  expect(execute).not.toHaveBeenCalled();
});
