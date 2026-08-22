/**
 * title — 智能会话标题（M7）。
 *
 * 触发算法（全部满足才生成，不是建会话就生成）：
 *   1. agentSettings.autoTitle 开关打开
 *   2. 标签是 session 且标题可被覆盖：未定名，或现标题来自自动命名
 *      （截断兜底 / AI）——手动 renameTab 过的 titleAuto=false，永不动
 *   3. 信息充分（任一）：≥3 个已完结命令块；或首个 AI 回答落定且 ≥50 字
 *   4. 距上次尝试 ≥60s（冷却）；停止活动 ≥5s（防抖，由调度方保证）
 *   5. 当前 provider 配了 API key（无 key 时截断兜底已生效，直接跳过）
 *
 * 生成：generateText 非流式，≤12 字中文标题，sanitize 后走
 * workspace.autoTitle（复用 rename 落库路径，named/titleAuto 置位）。
 */
import { generateText } from 'ai';
import { createChatModel } from './provider';
import { useAgentSettings } from './agentSettings';
import { useAiConfigStore, isApiKeyConfigured } from '../lib/ai';
import { useBlockStore } from '../stores/blocks';
import { useChatStore } from '../stores/chat';
import { useWorkspaceStore, isSessionTab } from '../stores/workspace';

export const TITLE_COOLDOWN_MS = 60_000;
export const TITLE_IDLE_MS = 5_000;
export const TITLE_MIN_DONE_BLOCKS = 3;
export const TITLE_MIN_ANSWER_CHARS = 50;
const MAX_TITLE_LEN = 16;

const lastAttempt = new Map<string, number>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

/** 收集生成标题的上下文；信息不充分返回 null（充分性判定也在这里） */
function gatherContext(tabId: string): { prompt: string } | null {
  const blocks = useBlockStore.getState().byTab[tabId] ?? [];
  const doneCmds = blocks
    .filter((b) => (b.status === 'done' || b.status === 'interrupted') && b.command)
    .map((b) => b.command);
  const msgs = useChatStore.getState().byTab[tabId] ?? [];
  const firstQ = msgs.find((m) => m.role === 'user' && m.content.trim());
  const firstA = msgs.find(
    (m) => m.role === 'assistant' && !m.pending && m.content.trim().length >= TITLE_MIN_ANSWER_CHARS,
  );
  if (doneCmds.length < TITLE_MIN_DONE_BLOCKS && !firstA) return null;
  const parts: string[] = [];
  if (doneCmds.length) parts.push('最近执行的命令：\n' + doneCmds.slice(-5).join('\n'));
  if (firstQ) parts.push('用户提问：' + firstQ.content.slice(0, 200));
  if (firstA) parts.push('AI 回答摘要：' + firstA.content.slice(0, 200));
  return { prompt: parts.join('\n\n') };
}

/** 模型输出 → 安全标题（去引号/换行、去尾标点、限长）；不可用返回 '' */
export function sanitizeTitle(raw: string): string {
  return raw
    .replace(/["'`「」『』《》\n\r\t]/g, '')
    .trim()
    .replace(/[。！？!?.…]+$/u, '')
    .slice(0, MAX_TITLE_LEN)
    .trim();
}

/** 条件判定 + 生成。返回是否落了新标题（测试直接断言）。 */
export async function maybeAutoTitle(tabId: string, now = Date.now()): Promise<boolean> {
  const settings = useAgentSettings.getState();
  if (!settings.autoTitle) return false;
  const tab = useWorkspaceStore.getState().tabs.find((t) => t.id === tabId);
  if (!tab || !isSessionTab(tab)) return false;
  if (tab.named && !tab.titleAuto) return false;
  if (now - (lastAttempt.get(tabId) ?? -Infinity) < TITLE_COOLDOWN_MS) return false;
  const ctx = gatherContext(tabId);
  if (!ctx) return false;
  if (!isApiKeyConfigured()) return false;
  lastAttempt.set(tabId, now);
  try {
    const cfg = useAiConfigStore.getState();
    const model = createChatModel({
      provider: cfg.provider,
      baseUrl: cfg.baseUrl,
      model: settings.titleModel || cfg.model,
    });
    const { text } = await generateText({
      model,
      prompt:
        '你是终端会话标题生成器。根据以下会话内容，用不超过 12 个字的中文概括一个标题。' +
        '只输出标题本身：不要引号、不要解释、不要句号收尾。\n\n' +
        ctx.prompt,
    });
    const title = sanitizeTitle(text);
    if (!title) return false;
    useWorkspaceStore.getState().autoTitle(tabId, title);
    return true;
  } catch (e) {
    console.warn('[title] 智能标题生成失败:', e);
    return false;
  }
}

/** 有活动 → 重置 5s 防抖定时器 */
function noteActivity(tabId: string) {
  clearTimeout(timers.get(tabId));
  timers.set(
    tabId,
    setTimeout(() => {
      timers.delete(tabId);
      void maybeAutoTitle(tabId);
    }, TITLE_IDLE_MS),
  );
}

/** 订阅 blockStore / chat store 的内容变化；返回解绑函数（App.tsx 挂一次） */
export function initAutoTitle(): () => void {
  const unBlocks = useBlockStore.subscribe((s, prev) => {
    for (const tabId of Object.keys(s.byTab)) {
      if (s.byTab[tabId] !== prev.byTab[tabId]) noteActivity(tabId);
    }
  });
  const unChat = useChatStore.subscribe((s, prev) => {
    for (const tabId of Object.keys(s.byTab)) {
      if (s.byTab[tabId] !== prev.byTab[tabId]) noteActivity(tabId);
    }
  });
  return () => {
    unBlocks();
    unChat();
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
  };
}

/** 测试用：清冷却计时与防抖定时器 */
export function resetTitleState() {
  lastAttempt.clear();
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
}
