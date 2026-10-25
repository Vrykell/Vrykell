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

it('does not execute queued commands after denial, cancellation or unconfirmed completion', async () => {
  for (const outcome of [
    { ok: false, denied: true, error: 'Confirmation unavailable' },
    { ok: false, completed: false, output: 'still running' },
  ]) {
    const queue = createCommandQueue();
    const skipped = vi.fn(async () => ({ ok: true }));
    const first = queue(async () => outcome); const next = queue(skipped);
    await first;
    expect(await next).toMatchObject({ ok: false });
    expect(skipped).not.toHaveBeenCalled();
  }
  const queue = createCommandQueue();
  const execute = vi.fn(async () => ({ ok: true }));
  const controller = new AbortController(); controller.abort();
  expect(await queue(execute, controller.signal)).toMatchObject({ completed: false });
  expect(await queue(execute)).toMatchObject({ completed: false });
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
