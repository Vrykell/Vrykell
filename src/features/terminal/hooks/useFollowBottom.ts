/** useFollowBottom — block 列表贴底跟随（Spec §3 滚动简化，替代 ScrollStateMachine）。 */

import { useCallback, useEffect, useRef } from 'react';

const BOTTOM_THRESHOLD_PX = 32; // ≈2 行

interface ViewAnchor {
  range: Range | null;
  element: HTMLElement;
  textTop: number | null;
  elementTop: number;
}

function textTop(range: Range | null, scroll: HTMLElement): number | null {
  if (!range?.startContainer.isConnected || !scroll.contains(range.startContainer)) return null;
  const rect = range.getBoundingClientRect();
  return rect.height > 0 ? rect.top : null;
}

function captureViewAnchor(scroll: HTMLElement): ViewAnchor | null {
  const viewport = scroll.getBoundingClientRect();
  if (viewport.width <= 0 || viewport.height <= 0) return null;
  const x = Math.min(viewport.right - 8, viewport.left + 80);
  const y = Math.min(viewport.bottom - 8, viewport.top + 20);
  const target = document.elementFromPoint(x, y);
  if (!target || !scroll.contains(target)) return null;
  const element = target.closest<HTMLElement>('[data-testid^="command-block-"], [data-testid^="running-block-"]')
    ?? target as HTMLElement;
  const caret = document.caretRangeFromPoint?.(x, y);
  const range = caret?.startContainer.nodeType === Node.TEXT_NODE
    && scroll.contains(caret.startContainer) ? caret.cloneRange() : null;
  const caretTop = textTop(range, scroll);
  return {
    range,
    element,
    textTop: caretTop === null ? null : caretTop - viewport.top,
    elementTop: element.getBoundingClientRect().top - viewport.top,
  };
}

/** paneId engage() 注册表：共享输入栏提交命令时，按聚焦 pane 复位对应列表的贴底跟随。
 *  （主列表按 activeId 注册，分屏各 pane 按 paneId 注册。） */
const engagers = new Map<string, () => void>();

/** 注册一个列表的 engage 回调，返回反注册函数。 */
export function registerFollowEngager(id: string, engage: () => void): () => void {
  engagers.set(id, engage);
  return () => {
    if (engagers.get(id) === engage) engagers.delete(id);
  };
}

/** 复位指定 pane 列表的贴底跟随（提交新命令时调用）。 */
export function engageFollow(id: string): void {
  engagers.get(id)?.();
}

/**
 * 滚动进度记录：滚动时把 scrollTop 存进内存表，pane 重挂载（切场景/布局重排等）
 * 后恢复，避免用户读到一半的进度被「回到底部」吞掉。
 */
const scrollMemory = new Map<string, number>();

/** 保存某 pane 列表的滚动位置。 */
export function saveScrollPos(key: string, top: number): void {
  scrollMemory.set(key, top);
}

/** 读取并消费某 pane 的滚动位置（读后清除，防止陈旧位置在下次重挂载时被误恢复）。 */
function takeScrollPos(key: string): number | null {
  const v = scrollMemory.get(key);
  if (v === undefined) return null;
  scrollMemory.delete(key);
  return v;
}

/** 用户主动贴底（提交新命令/按 End）时清掉记录，避免下次恢复时又被拉回旧位置。 */
function clearScrollPos(key: string): void {
  scrollMemory.delete(key);
}

/**
 * 返回 engage()：强制复位 latch 并立即贴底。
 * 用户上滚后 latch 脱离（不再跟随），但「提交新命令」是明确的回底意图
 * （），调用方在提交时调 engage() 复位。
 *
 * latch 只应被「用户滚动」杀死。程序化 snap 的 scroll 事件是异步派发的，
 * 派发时内容可能已增长（submit 后新 block 很快渲染），若按当时位置量 gap
 * 会误判为上滚 → latch 死亡 → 跟随在输出流中段停摆（「只滚到一半」）。
 * 因此记录每次 snap 的实际 scrollTop，scroll 事件落在该位置视为自引发。
 *
 * persistKey 传入时启用滚动进度记录：滚动位置按 key 持久化，挂载时恢复。
 */
export function useFollowBottom(
  scrollRef: React.RefObject<HTMLDivElement | null>,
  deps: unknown[],
  persistKey?: string,
): () => void {
  const atBottomRef = useRef(true);
  /** 最近一次 snap 读回的实际 scrollTop（浏览器 clamp 后的值）；-1 = 尚未 snap */
  const snappedTopRef = useRef(-1);

  const snap = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    snappedTopRef.current = el.scrollTop; // 读回 clamp 后的实际值
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let width = el.clientWidth;
    let height = el.clientHeight;
    let anchor: ViewAnchor | null = null;
    let restoredTop: number | null = null;
    const restoreAnchor = () => {
      if (!anchor) return;
      if (!anchor.element.isConnected || !el.contains(anchor.element)) {
        anchor = captureViewAnchor(el);
        return;
      }
      const caretTop = textTop(anchor.range, el);
      const viewportTop = el.getBoundingClientRect().top;
      let offset = anchor.element.getBoundingClientRect().top - viewportTop - anchor.elementTop;
      if (caretTop !== null && anchor.textTop !== null) {
        offset = caretTop - viewportTop - anchor.textTop;
      }
      if (Math.abs(offset) < 0.5) return;
      el.scrollTop += offset;
      restoredTop = el.scrollTop;
      if (persistKey) saveScrollPos(persistKey, restoredTop);
    };
    // 挂载时恢复上次记录的滚动进度；恢复后按实际位置校正 latch，
    // 避免随后的 snap（content 变化时）把用户又拉回底部。
    if (persistKey) {
      const saved = takeScrollPos(persistKey);
      if (saved != null) {
        el.scrollTop = saved;
        atBottomRef.current =
          el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_THRESHOLD_PX;
        if (!atBottomRef.current) anchor = captureViewAnchor(el);
      }
    }
    const onScroll = () => {
      if (el.clientWidth !== width || el.clientHeight !== height) {
        width = el.clientWidth;
        height = el.clientHeight;
        if (atBottomRef.current) snap();
        else restoreAnchor();
        return;
      }
      if (restoredTop !== null && Math.abs(el.scrollTop - restoredTop) < 1) {
        restoredTop = null;
        return;
      }
      restoredTop = null;
      // 自引发的 scroll 事件（snap 位置）：即使内容已增长也保持贴底
      if (el.scrollTop === snappedTopRef.current) {
        atBottomRef.current = true;
        anchor = null;
        return;
      }
      atBottomRef.current =
        el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_THRESHOLD_PX;
      anchor = atBottomRef.current ? null : captureViewAnchor(el);
      if (persistKey) saveScrollPos(persistKey, el.scrollTop);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    // Observe the whole output flow because live xterm height changes outside React.
    const content = el.firstElementChild;
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      width = el.clientWidth;
      height = el.clientHeight;
      if (atBottomRef.current) snap();
      else restoreAnchor();
    });
    ro?.observe(el);
    if (content) ro?.observe(content);
    return () => {
      el.removeEventListener('scroll', onScroll);
      ro?.disconnect();
    };
    // 滚动容器 div 生命周期与组件一致，只需在挂载时订阅一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!atBottomRef.current) return;
    requestAnimationFrame(() => {
      // 滚动期间用户可能已上滚，需重新确认贴底状态
      if (!atBottomRef.current) return;
      snap();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return useCallback(() => {
    atBottomRef.current = true;
    if (persistKey) clearScrollPos(persistKey);
    snap();
  }, [snap, persistKey]);
}
