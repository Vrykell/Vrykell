/**
 * useTerminalFocus — blockList 场景有运行中 block 时，把键盘焦点交给块内活 xterm。
 *
 * 为什么不自己翻译按键：xterm 的隐藏 textarea + CompositionHelper 提供完整的
 * 按键翻译（Backspace/Ctrl/方向键/功能键）、IME 组合（compositionstart/end 屏蔽、
 * 提交文本落盘）和粘贴 —— 块终端的 onData → ptyWrite 已在 RunningTerm 接线。
 * 即「运行中块的键盘」与 classic 场景走同一条久经考验的输入路径（ 的运行块
 * 同理：活终端栅格持有真实光标与 IME 输入）。手搓 key→字节 翻译在 WebKit 下
 * 会漏拼音、丢退格，不可维护。
 *
 * 本 hook 只管焦点调度：焦点空闲（落 body）时收归 xterm；输入栏/命令面板/AI
 * 输入框等可编辑目标聚焦时不动；用户划选文本时不抢。
 */

import { useEffect } from 'react';
import { termInstances } from '@features/terminal';
import { getExecutingTerm } from '@features/terminal/hooks/useTerminalSession';
import { isTerminalDebugEnabled, terminalDebug } from '@features/terminal/services/terminalDebug';

const isEditable = (t: EventTarget | null): boolean => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
};

/** A drag in progress or a finished text selection must own the pointer/focus, not the terminal. */
const hasTextSelection = (): boolean => {
  const selection = window.getSelection();
  return !!selection && selection.rangeCount > 0 && !selection.isCollapsed;
};

/**
 * @param active 仅当 blockList 场景且有 executing block 时开启
 * @param tabId  目标 tab（优先聚焦块内活终端，取不到时回退主 xterm）
 */
export function useTerminalFocus(active: boolean, tabId: string): void {
  useEffect(() => {
    if (!active) return;
    const term = getExecutingTerm(tabId)?.term ?? termInstances.get(tabId);
    if (!term) return;
    let lastFocusState = '';
    // While a pointer is held the user may be selecting block text; focusing the terminal
    // mid-drag collapses the browser selection before mouseup.
    let pointerPressed = false;
    const recordFocusState = (state: string, focused: boolean) => {
      if (!isTerminalDebugEnabled() || lastFocusState === state) return;
      lastFocusState = state;
      terminalDebug('terminal-focus', { tabId, state, focused, mounted: Boolean(term.element) });
    };

    // 焦点空闲（落 body）时收归 xterm —— 关键场景：长运行后输入栏隐藏，焦点掉回
    // body；若焦点不到位，IME 无法起组合、按键无处去。
    const grabIfIdle = () => {
      if (pointerPressed || hasTextSelection()) return;
      const ae = document.activeElement as HTMLElement | null;
      if (!ae || ae === document.body || ae === document.documentElement) {
        if (!term.element) {
          recordFocusState('terminal-not-mounted', false);
          return;
        }
        term.focus();
        const textarea = term.element.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea');
        const focused = Boolean(textarea && document.activeElement === textarea);
        recordFocusState(focused ? 'focused' : 'focus-not-applied', focused);
      }
    };
    grabIfIdle(); // 激活时：若焦点本就空闲，立即就位
    const onFocusOut = () => {
      // focusout→focusin 同步连发，延迟一拍看最终落点
      setTimeout(grabIfIdle, 0);
    };
    // 输入栏隐藏若是 display:none/卸载，焦点丢失不一定触发 focusout —— 低频轮询兜底
    const focusPoll = setInterval(grabIfIdle, 500);

    // 点击面板空白处即预聚焦 xterm（划选文本时不抢焦点）
    const onClick = (e: MouseEvent) => {
      pointerPressed = false;
      const pane = term.element?.closest('.terminal-pane');
      if (!(e.target instanceof Node) || !(pane?.contains(e.target) || term.element?.contains(e.target))) return;
      if (isEditable(e.target)) return;
      if (hasTextSelection()) return;
      term.focus();
    };
    const onPointerDown = (event: MouseEvent) => { if (event.button === 0) pointerPressed = true; };
    const onPointerUp = () => { pointerPressed = false; };

    window.addEventListener('focusout', onFocusOut);
    window.addEventListener('click', onClick);
    // Capture phase: a child handler calling stopPropagation must not hide the press.
    window.addEventListener('mousedown', onPointerDown, true);
    window.addEventListener('mouseup', onPointerUp, true);
    window.addEventListener('blur', onPointerUp);
    return () => {
      clearInterval(focusPoll);
      window.removeEventListener('focusout', onFocusOut);
      window.removeEventListener('click', onClick);
      window.removeEventListener('mousedown', onPointerDown, true);
      window.removeEventListener('mouseup', onPointerUp, true);
      window.removeEventListener('blur', onPointerUp);
    };
  }, [active, tabId]);
}
