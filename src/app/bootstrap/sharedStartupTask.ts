/** Development lifecycle replay must share one restoration, including after completion. */
export function createSharedStartupTask(task: () => Promise<void>) {
  let pending: Promise<void> | undefined;
  return () => {
    pending ??= Promise.resolve().then(task).catch(error => { pending = undefined; throw error; });
    return pending;
  };
}
