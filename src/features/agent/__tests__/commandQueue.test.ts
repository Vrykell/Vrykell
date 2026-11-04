import { expect, it, vi } from 'vitest';
import { createCommandQueue } from '../services/commandQueue';

it('serializes concurrent commands before authorization and execution', async () => {
  let finish: (value: { ok: boolean; completed: boolean; output: string }) => void = () => {};
  const pending = new Promise<{ ok: boolean; completed: boolean; output: string }>(resolve => { finish = resolve; });
  const first = vi.fn(() => pending);
  const second = vi.fn(async () => ({ ok: true, completed: true, output: 'second' }));
  const queue = createCommandQueue();
  const firstResult = queue(first); const secondResult = queue(second);
  await Promise.resolve();
  expect(first).toHaveBeenCalledOnce(); expect(second).not.toHaveBeenCalled();
  finish({ ok: true, completed: true, output: 'first' });
  expect(await firstResult).toMatchObject({ output: 'first' });
  expect(await secondResult).toMatchObject({ output: 'second' });
  expect(second).toHaveBeenCalledOnce();
});

it('keeps an unconfirmed command blocked until the terminal reports ready, then preserves its cause', async () => {
  let ready = false;
  const queue = createCommandQueue({ isReady: () => ready });
  const timeout = { ok: false, completed: false, output: '', code: 'COMMAND_TIMEOUT', error: 'Timed out' };
  expect(await queue(async () => timeout)).toBe(timeout);

  const skipped = vi.fn(async () => ({ ok: true, completed: true, output: 'recovered' }));
  const blocked = await queue(skipped);
  expect(blocked).toMatchObject({ ok: false, completed: false, code: 'PREVIOUS_COMMAND_UNCONFIRMED', requiresUserAction: true });
  expect(blocked).toMatchObject({ error: expect.stringContaining('Timed out') });
  expect(skipped).not.toHaveBeenCalled();

  ready = true;
  expect(await queue(skipped)).toMatchObject({ ok: true, output: 'recovered' });
  expect(skipped).toHaveBeenCalledOnce();
});

it('never runs a command queued before an unconfirmed completion, even after the terminal becomes ready', async () => {
  let ready = false;
  let finish!: (value: { ok: boolean; completed: boolean; code: string }) => void;
  const pending = new Promise<{ ok: boolean; completed: boolean; code: string }>(resolve => { finish = resolve; });
  const queue = createCommandQueue({ isReady: () => ready });
  const first = queue(() => pending);
  const skipped = vi.fn(async () => ({ ok: true, completed: true, output: 'recovered' }));
  const queuedBeforeBoundary = queue(skipped);

  ready = true;
  finish({ ok: false, completed: false, code: 'COMMAND_TIMEOUT' });
  expect(await first).toMatchObject({ code: 'COMMAND_TIMEOUT' });
  expect(await queuedBeforeBoundary).toMatchObject({ code: 'PREVIOUS_COMMAND_UNCONFIRMED' });
  expect(skipped).not.toHaveBeenCalled();

  expect(await queue(skipped)).toMatchObject({ ok: true, output: 'recovered' });
  expect(skipped).toHaveBeenCalledOnce();
});

it('keeps denials hard even when the terminal is ready', async () => {
  const queue = createCommandQueue({ isReady: () => true });
  const denied = { ok: false, denied: true, error: 'Confirmation unavailable' };
  expect(await queue(async () => denied)).toBe(denied);

  const skipped = vi.fn(async () => ({ ok: true, completed: true, output: 'no' }));
  expect(await queue(skipped)).toBe(denied);
  expect(skipped).not.toHaveBeenCalled();
});

it('does not poison the queue after a transient busy result', async () => {
  const queue = createCommandQueue({ isReady: () => false });
  const busy = { ok: false, completed: false, output: '', code: 'TERMINAL_BUSY', error: 'Busy' };
  expect(await queue(async () => busy)).toBe(busy);

  const execute = vi.fn(async () => ({ ok: true, completed: true, output: 'ok' }));
  expect(await queue(execute)).toMatchObject({ ok: true });
  expect(execute).toHaveBeenCalledOnce();
});

it('keeps an aborted turn hard even when the terminal is ready', async () => {
  const queue = createCommandQueue({ isReady: () => true });
  const controller = new AbortController(); controller.abort();
  expect(await queue(vi.fn(), controller.signal)).toMatchObject({ ok: false, completed: false, code: 'COMMAND_ABORTED' });

  const execute = vi.fn(async () => ({ ok: true, completed: true, output: 'no' }));
  expect(await queue(execute)).toMatchObject({ completed: false });
  expect(execute).not.toHaveBeenCalled();
});

it('keeps a failed terminal write hard even when the terminal is ready', async () => {
  const queue = createCommandQueue({ isReady: () => true });
  const failed = { ok: false, completed: false, output: '', code: 'TERMINAL_WRITE_FAILED', error: 'Write failed' };
  expect(await queue(async () => failed)).toBe(failed);

  const execute = vi.fn(async () => ({ ok: true, completed: true, output: 'no' }));
  expect(await queue(execute)).toBe(failed);
  expect(execute).not.toHaveBeenCalled();
});

it('does not reuse an interrupted turn after a terminal reconnects in the same pane', async () => {
  const queue = createCommandQueue({ isReady: () => true });
  const disconnected = { ok: false, completed: false, output: '', code: 'TERMINAL_DISCONNECTED', requiresUserAction: true };
  expect(await queue(async () => disconnected)).toBe(disconnected);
  const execute = vi.fn(async () => ({ ok: true, completed: true, output: 'wrong session' }));
  expect(await queue(execute)).toBe(disconnected);
  expect(execute).not.toHaveBeenCalled();
});

it('continues after a completed diagnostic nonzero exit and isolates independent turns', async () => {
  const queue = createCommandQueue();
  await queue(async () => ({ ok: false, completed: true, exitCode: 3, output: 'inactive' }));
  const execute = vi.fn(async () => ({ ok: true, completed: true, output: 'checked' }));
  expect(await queue(execute)).toMatchObject({ ok: true });
  await queue(async () => ({ ok: false, denied: true }));
  expect(await createCommandQueue()(execute)).toMatchObject({ ok: true });
});
