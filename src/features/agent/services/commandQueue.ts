import { t } from '@i18n';
import type { GateResult } from '../stores/permissions';
import type { RunCommandResult } from '../tools/runCommand';

type CommandResult = GateResult | (RunCommandResult & { command?: string });
type BlockKind = 'hard' | 'until-ready';

interface BlockedCommand {
  result: CommandResult;
  kind: BlockKind;
  /** Increments on each boundary so calls queued before it cannot recover. */
  generation: number;
}

export interface CommandQueueOptions {
  /** Called when a later submission may lift a soft block; true only when the terminal is safe. */
  isReady?: () => boolean;
}

const BLOCKED_CODE = 'PREVIOUS_COMMAND_UNCONFIRMED';
const FAILED_CODE = 'COMMAND_FAILED';

function isDenied(result: CommandResult): boolean {
  return 'denied' in result && result.denied === true;
}

function codeOf(result: CommandResult): string | undefined {
  return 'code' in result ? result.code : undefined;
}

/**
 * A denial, abort, disconnect or failed write ends the turn. An unconfirmed completion is a soft boundary
 * that clears only after the terminal readiness check accepts another write. Busy is transient
 * and already guarded by the execution preflight.
 */
function blockKind(result: CommandResult): BlockKind | null {
  if (isDenied(result)) return 'hard';
  if (!('completed' in result) || result.completed !== false) return null;
  const code = codeOf(result);
  if (code === 'TERMINAL_BUSY') return null;
  // These boundaries may have left partial input or belong to a cancelled turn; a new turn is required.
  if (code === 'COMMAND_ABORTED' || code === 'TERMINAL_WRITE_FAILED' || code === 'TERMINAL_DISCONNECTED') return 'hard';
  return 'until-ready';
}

function errorOf(result: CommandResult): string | undefined {
  return 'error' in result && result.error ? result.error : undefined;
}

function blockedResult(blocked: BlockedCommand): CommandResult {
  if (blocked.kind === 'hard') return blocked.result;
  const cause = errorOf(blocked.result);
  return {
    ok: false,
    completed: false,
    output: '',
    code: BLOCKED_CODE,
    requiresUserAction: true,
    error: cause
      ? t('The previous command did not complete: {{cause}} Wait until the terminal is ready, or end this turn and send a new message.', { cause })
      : t('The previous command did not complete. Wait until the terminal is ready, or end this turn and send a new message.'),
  };
}

function cancelledResult(): CommandResult {
  return {
    ok: false, completed: false, output: '', code: 'COMMAND_ABORTED',
    error: t('Command cancelled before execution.'),
  };
}

function failedResult(): CommandResult {
  return {
    ok: false, completed: false, output: '', code: FAILED_CODE,
    error: t('The previous tool call failed. End this turn and send a new message before requesting more commands.'),
  };
}

export function createCommandQueue(options: CommandQueueOptions = {}) {
  let tail = Promise.resolve();
  let blocked: BlockedCommand | null = null;
  let generation = 0;
  return (execute: () => Promise<CommandResult>, signal?: AbortSignal): Promise<CommandResult> => {
    const submittedAt = generation;
    const queued = tail.then(async () => {
      if (signal?.aborted) {
        const entry: BlockedCommand = { result: cancelledResult(), kind: 'hard', generation: ++generation };
        blocked = entry;
        return entry.result;
      }
      if (blocked) {
        // A call queued before the boundary stays blocked even if the terminal became ready.
        const recoverable = blocked.kind === 'until-ready'
          && submittedAt >= blocked.generation
          && options.isReady?.() === true;
        if (recoverable) blocked = null;
        else return blockedResult(blocked);
      }
      const result = await execute();
      const kind = blockKind(result);
      if (kind) {
        blocked = { result, kind, generation: ++generation };
      }
      return result;
    });
    tail = queued.then(() => undefined, () => {
      blocked = { result: failedResult(), kind: 'hard', generation: ++generation };
    });
    return queued;
  };
}
