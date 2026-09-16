/**
 * inputVisibility.test.ts — 输入框可见性状态机测试（对应文档 §7）。
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
  it('默认可见', () => {
    expect(isInputBoxVisible(ctx())).toBe(true);
  });

  it('只读模式 → 隐藏', () => {
    expect(isInputBoxVisible(ctx({ isReadOnly: true }))).toBe(false);
  });

  it('全屏 TUI → 隐藏', () => {
    expect(isInputBoxVisible(ctx({ isAltScreenActive: true }))).toBe(false);
  });

  it('长运行命令 → 隐藏', () => {
    expect(isInputBoxVisible(ctx({ isLongRunning: true }))).toBe(false);
  });

  it('长运行 + agent 控制 → 可见', () => {
    expect(
      isInputBoxVisible(ctx({ isLongRunning: true, isAgentInControl: true })),
    ).toBe(true);
  });

  it('长运行 + agent tagged → 可见', () => {
    expect(
      isInputBoxVisible(ctx({ isLongRunning: true, isAgentTaggedIn: true })),
    ).toBe(true);
  });

  it('只读优先级高于其他 → 始终隐藏', () => {
    expect(isInputBoxVisible(ctx({ isReadOnly: true, isAgentInControl: true }))).toBe(false);
  });

  it('TUI 优先级高于 agent → 隐藏', () => {
    expect(
      isInputBoxVisible(
        ctx({ isAltScreenActive: true, isAgentInControl: true }),
      ),
    ).toBe(false);
  });
});

describe('getLongRunningHint', () => {
  it('短命令名完整显示', () => {
    const hint = getLongRunningHint('npm run dev');
    expect(hint).toContain('npm run dev');
    expect(hint).toContain('按 End 回到输入栏');
  });

  it('长命令名截断', () => {
    const hint = getLongRunningHint('this-is-a-very-long-command-with-60-plus-chars');
    expect(hint).toContain('...');
    expect(hint.length).toBeLessThan(80);
  });
});
