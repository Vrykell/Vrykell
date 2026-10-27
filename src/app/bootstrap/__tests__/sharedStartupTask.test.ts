import { expect, it, vi } from 'vitest';
import { createSharedStartupTask } from '../sharedStartupTask';

it('shares pending and completed restoration across lifecycle replay', async () => {
  let finish!: () => void;
  const task = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  const restore = createSharedStartupTask(task);
  const first = restore(); expect(restore()).toBe(first);
  await Promise.resolve(); expect(task).toHaveBeenCalledOnce(); finish(); await first;
  expect(restore()).toBe(first); expect(task).toHaveBeenCalledOnce();
});

it('allows a fresh attempt after restoration fails', async () => {
  const task = vi.fn().mockRejectedValueOnce(new Error('startup failed')).mockResolvedValue(undefined);
  const restore = createSharedStartupTask(task);
  await expect(restore()).rejects.toThrow('startup failed'); await restore();
  expect(task).toHaveBeenCalledTimes(2);
});
