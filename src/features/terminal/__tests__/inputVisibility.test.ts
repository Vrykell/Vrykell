/**
 * inputVisibility.test.ts - input box visibility state machine tests (documentation section 7).
 */

import { describe, it, expect } from 'vitest';
import { isInputBoxVisible, getLongRunningHint } from '@features/terminal/inputVisibility';
import type { InputVisibilityContext } from '@features/terminal/inputVisibility';

function ctx(overrides: Partial<InputVisibilityContext> = {}): InputVisibilityContext {
  return {
    isReadOnly: false,
    isAltScreenActive: false,
    isLongRunning: false,
    isAgentInControl: false,
    isAgentTaggedIn: false,
    ...overrides,
  };
}

describe('isInputBoxVisible', () => {
  it('visible by default', () => {
    expect(isInputBoxVisible(ctx())).toBe(true);
  });

  it('read-only mode -> hidden', () => {
    expect(isInputBoxVisible(ctx({ isReadOnly: true }))).toBe(false);
  });

  it('fullscreen TUI -> hidden', () => {
    expect(isInputBoxVisible(ctx({ isAltScreenActive: true }))).toBe(false);
  });

  it('long-running command -> hidden', () => {
    expect(isInputBoxVisible(ctx({ isLongRunning: true }))).toBe(false);
  });

  it('long-running + agent in control -> visible', () => {
    expect(
      isInputBoxVisible(ctx({ isLongRunning: true, isAgentInControl: true })),
    ).toBe(true);
  });

  it('long-running + agent tagged -> visible', () => {
    expect(
      isInputBoxVisible(ctx({ isLongRunning: true, isAgentTaggedIn: true })),
    ).toBe(true);
  });

  it('read-only outranks the others -> always hidden', () => {
    expect(isInputBoxVisible(ctx({ isReadOnly: true, isAgentInControl: true }))).toBe(false);
  });

  it('TUI outranks agent -> hidden', () => {
    expect(
      isInputBoxVisible(
        ctx({ isAltScreenActive: true, isAgentInControl: true }),
      ),
    ).toBe(false);
  });
});

describe('getLongRunningHint', () => {
  it('a short command name is shown in full', () => {
    const hint = getLongRunningHint('npm run dev');
    expect(hint).toContain('npm run dev');
    expect(hint).toContain('运行中');
  });

  it('a long command name is truncated', () => {
    const hint = getLongRunningHint('this-is-a-very-long-command-with-60-plus-chars');
    expect(hint).toContain('...');
    expect(hint.length).toBeLessThan(80);
  });
});
