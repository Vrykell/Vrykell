import { expect, it } from 'vitest';
import { prepareToolRecoveryStep, TOOL_RECOVERY_GUIDANCE } from '../model/toolRecovery';

it('allows normal failures to be diagnosed without suppressing tools', () => {
  for (const output of [null, 'denied', { ok: false, exitCode: 3 }, { ok: false, completed: false }, { denied: false }]) {
    expect(prepareToolRecoveryStep({ steps: [{ toolResults: [{ output }] }] })).toBeUndefined();
  }
});

it('forces a text-only handoff after any denial in the current turn', () => {
  expect(prepareToolRecoveryStep({ steps: [] })).toBeUndefined();
  expect(prepareToolRecoveryStep({ steps: [
    { toolResults: [{ output: { ok: false, denied: true, error: 'Confirmation unavailable' } }] },
    { toolResults: [{ output: { ok: true } }] },
  ] })).toEqual({ toolChoice: 'none' });
  expect(TOOL_RECOVERY_GUIDANCE).toContain('Never retry with another tool');
  expect(TOOL_RECOVERY_GUIDANCE).toContain('executionState=unknown');
  expect(prepareToolRecoveryStep({ steps: [{ toolResults: [{ output: { denied: true } }] }] }, true)).toEqual({ activeTools: ['ask_user'] });
});
