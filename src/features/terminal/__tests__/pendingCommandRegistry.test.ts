import { afterEach, describe, expect, it } from 'vitest';
import { registerPendingCommand, setPendingCommandRegistrar } from '../services/pendingCommandRegistry';

describe('pending command registry', () => {
  afterEach(() => setPendingCommandRegistrar(null));

  it('forwards writes to the registered controller hook and tolerates no hook', () => {
    const calls: Array<[string, string, string]> = [];
    registerPendingCommand('pane', 'command', 'payload');
    expect(calls).toEqual([]);
    setPendingCommandRegistrar((paneId, command, payload) => { calls.push([paneId, command, payload]); });
    registerPendingCommand('pane', 'command', 'payload');
    expect(calls).toEqual([['pane', 'command', 'payload']]);
    setPendingCommandRegistrar(null);
    registerPendingCommand('pane', 'command', 'payload');
    expect(calls).toEqual([['pane', 'command', 'payload']]);
  });
});
