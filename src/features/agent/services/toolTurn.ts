import { endsToolUse } from '../model/toolRecovery';

/** Serialize local execution so a boundary also stops calls from the same model step. */
export class ToolTurn {
  private tail = Promise.resolve();
  private blocked = false;

  observe(name: string, result: unknown) { this.blocked ||= endsToolUse(name, result); }
  stop() { this.blocked = true; }

  run<T>(execute: () => PromiseLike<T> | T, unavailable: () => T, signal?: AbortSignal): Promise<T> {
    const queued = this.tail.then(async () => {
      if (this.blocked || signal?.aborted) return unavailable();
      return await execute();
    });
    this.tail = queued.then(() => undefined, () => { this.blocked = true; });
    return queued;
  }
}
