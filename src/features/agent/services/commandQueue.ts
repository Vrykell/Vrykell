import { t } from '@i18n';
import type { GateResult } from '../stores/permissions';
import type { RunCommandResult } from '../tools/runCommand';

type CommandResult = GateResult | (RunCommandResult & { command?: string });

export function createCommandQueue() {
  let tail = Promise.resolve();
  let blocked: CommandResult | null = null;
  return (execute: () => Promise<CommandResult>, signal?: AbortSignal): Promise<CommandResult> => {
    const queued = tail.then(async () => {
      if (signal?.aborted) {
        blocked = { ok: false, completed: false, output: '', error: t('Command cancelled before execution.') };
        return blocked;
      }
      if (blocked) return blocked;
      const result = await execute();
      if ('denied' in result && result.denied) blocked = result;
      else if ('completed' in result && result.completed === false) blocked = {
        ok: false, completed: false, output: '', error: t('A previous command has not completed. Inspect the terminal before requesting more commands.'),
      };
      return result;
    });
    tail = queued.then(() => undefined, () => {
      blocked = { ok: false, completed: false, output: '', error: t('A previous command has not completed. Inspect the terminal before requesting more commands.') };
    });
    return queued;
  };
}
