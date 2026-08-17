import { create } from 'zustand';
import { safeJsonParse, safeLocalStorageGet, safeLocalStorageSet } from '../lib/errorHandler';

/**
 * useTerminalLayoutStore — 终端区域 4 象限停靠布局。
 *
 * 终端主区域最多停靠 4 个终端（2×2 网格：左上/右上/左下/右下）。
 * 每个槽位存一个 tabId（local/ssh 等任意真实会话标签）；同一 tab 最多出现在一个槽位。
 * 布局持久化到 localStorage（位置记忆），拖拽标签到槽位即可调整位置。
 *
 * 聚焦态沿用 workspace.activeId（点击槽位 = activate 该标签，输入/块路由到该 tab 的 PTY）。
 */

export type Slot = 0 | 1 | 2 | 3; // 0=左上 1=右上 2=左下 3=右下

const STORAGE_KEY = 'terminal-layout-v1';
const SLOT_COUNT = 4;

function emptySlots(): (string | null)[] {
  return [null, null, null, null];
}

function sanitize(slots: unknown): (string | null)[] {
  if (!Array.isArray(slots) || slots.length !== SLOT_COUNT) return emptySlots();
  const seen = new Set<string>();
  return slots.map((v) => {
    if (typeof v !== 'string' || v === '' || seen.has(v)) return null;
    seen.add(v);
    return v;
  });
}

function loadSlots(): (string | null)[] {
  const raw = safeLocalStorageGet(STORAGE_KEY);
  if (!raw) return emptySlots();
  const parsed = safeJsonParse<unknown>(raw);
  if (!parsed || typeof parsed !== 'object') return emptySlots();
  return sanitize((parsed as { slots?: unknown }).slots);
}

function saveSlots(slots: (string | null)[]): void {
  safeLocalStorageSet(STORAGE_KEY, JSON.stringify({ slots }));
}

interface TerminalLayoutState {
  /** 4 个槽位（左上/右上/左下/右下），值为 tabId 或 null */
  slots: (string | null)[];
  /** 当前聚焦的 tab（null = 回退 workspace.activeId） */
  focusedTabId: string | null;

  /** 把 tab 停靠到指定槽位（若已停靠则移动；覆盖目标槽位原 tab 使其回退侧栏） */
  dockTab: (tabId: string, slot: Slot) => void;
  /** 取消停靠（tab 仍留在侧栏，只是退出网格） */
  undockTab: (tabId: string) => void;
  /** 聚焦某个槽位（输入/块路由到该 tab） */
  focusTab: (tabId: string | null) => void;
  /** 清空全部停靠 */
  clear: () => void;
  /** 是否有 tab 停靠 */
  isDocked: (tabId: string) => boolean;
  /** 第一个空槽位（null = 已满） */
  firstFreeSlot: () => Slot | null;
  /** 剔除已不存在的 tab id（重启后 tab id 变化，清掉陈旧槽位） */
  reconcile: (validTabIds: Set<string>) => void;
}

export const useTerminalLayoutStore = create<TerminalLayoutState>((set, get) => ({
  slots: loadSlots(),
  focusedTabId: null,

  dockTab: (tabId, slot) =>
    set((s) => {
      // 先从其它槽位移除该 tab，再放到目标槽位（覆盖目标槽位的旧 tab）
      const next = s.slots.map((t) => (t === tabId ? null : t));
      next[slot] = tabId;
      saveSlots(next);
      return { slots: next, focusedTabId: tabId };
    }),

  undockTab: (tabId) =>
    set((s) => {
      if (!s.slots.includes(tabId)) return s;
      const next = s.slots.map((t) => (t === tabId ? null : t));
      saveSlots(next);
      const focused = s.focusedTabId === tabId ? null : s.focusedTabId;
      return { slots: next, focusedTabId: focused };
    }),

  focusTab: (tabId) => set({ focusedTabId: tabId }),

  clear: () => {
    saveSlots(emptySlots());
    set({ slots: emptySlots(), focusedTabId: null });
  },

  isDocked: (tabId) => get().slots.includes(tabId),

  firstFreeSlot: () => {
    const idx = get().slots.findIndex((t) => t === null);
    return idx === -1 ? null : (idx as Slot);
  },

  reconcile: (validTabIds) =>
    set((s) => {
      const next = s.slots.map((t) => (t && validTabIds.has(t) ? t : null));
      saveSlots(next);
      return { slots: next };
    }),
}));

/** 某 tab 当前所在槽位（未停靠 = -1）。 */
export function slotOf(slots: (string | null)[], tabId: string): number {
  return slots.findIndex((t) => t === tabId);
}

/** 计算某槽位在「仅保留已占用行/列」的网格里的 (row, col)。 */
export function gridPosition(slots: (string | null)[]): { row: number; col: number }[] {
  const occ = slots.map((s, i) => (s ? i : -1));
  const bottomRow = occ.some((i) => i === 2 || i === 3);
  const rightCol = occ.some((i) => i === 1 || i === 3);

  const rowOf = (slot: number) => (slot < 2 ? 0 : 1);
  const colOf = (slot: number) => (slot % 2 === 0 ? 0 : 1);

  return slots.map((s, i) => {
    if (!s) return { row: -1, col: -1 };
    // 若底行无占用，则底行槽位也挤到第 0 行；右列同理
    const row = bottomRow ? rowOf(i) : 0;
    const col = rightCol ? colOf(i) : 0;
    return { row, col };
  });
}

/** 计算网格行列数（用于 CSS grid template）。 */
export function gridDimensions(slots: (string | null)[]): { rows: number; cols: number } {
  const occ = slots.map((s, i) => (s ? i : -1));
  const topRow = occ.some((i) => i === 0 || i === 1);
  const bottomRow = occ.some((i) => i === 2 || i === 3);
  const leftCol = occ.some((i) => i === 0 || i === 2);
  const rightCol = occ.some((i) => i === 1 || i === 3);
  return {
    rows: (topRow ? 1 : 0) + (bottomRow ? 1 : 0),
    cols: (leftCol ? 1 : 0) + (rightCol ? 1 : 0),
  };
}
