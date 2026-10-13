/**
 * Smart session titles.
 *
 * Trigger algorithm (a title is generated only when all hold, not on tab creation):
 *   1. `agentSettings.autoTitle` is on.
 *   2. The tab is a session whose title may be overwritten: unnamed, or carrying a generated
 *      title (command/message/AI). A manually renamed tab (`titleSource === 'manual'`) is never
 *      touched unless the caller asks (`allowManual`, used by the regenerate command).
 *   3. Enough signal: at least {@link TITLE_MIN_DONE_BLOCKS} finished command blocks, or a first
 *      AI answer of {@link TITLE_MIN_ANSWER_CHARS} characters.
 *   4. At least {@link TITLE_COOLDOWN_MS} since the last try; idle for {@link TITLE_IDLE_MS}
 *      (the caller debounces).
 *   5. An API key is configured; without one the heuristic fallback has already applied.
 *
 * Generation: `generateText` (non-streaming), a <=12-character title, sanitized and applied
 * through `workspace.autoTitle`. Without an API key the heuristic summarizer is used instead.
 */
import { generateText } from 'ai';
import { createChatModel } from '@features/agent/services/provider';
import { useAgentSettings } from '@features/agent/stores/agentSettings';
import { activeModelProfile, isApiKeyConfigured } from '@features/agent/stores/aiConfig';
import { useBlockStore } from '@features/terminal';
import { useChatStore } from '@features/chat';
import { useSessionStore, isSessionTab } from '@features/workspace';
import { leaves } from '@features/workspace/model/windowLayout';
import {
  MAX_TITLE_LEN,
  normalizeCommandForTitle,
  sanitizeTitle,
  truncateTitle,
} from '@features/workspace/model/sessionTitle';

export const TITLE_COOLDOWN_MS = 60_000;
export const TITLE_IDLE_MS = 5_000;
export const TITLE_MIN_DONE_BLOCKS = 3;
export const TITLE_MIN_ANSWER_CHARS = 50;
/** Messages may grow by this much before the title is generated again. */
export const TITLE_RETITLE_STEP = 30;

export { sanitizeTitle };

export interface AutoTitleOptions {
  /** Ignore the cooldown (scale-triggered retitle and the regenerate command). */
  bypassCooldown?: boolean;
  /** Replace a manually named title (the user-triggered regenerate command only). */
  allowManual?: boolean;
}

const lastAttempt = new Map<string, number>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
/** Message count when a tab was last named (for the scale-triggered retitle). */
const titledCount = new Map<string, number>();

function sessionBlocks(tabId: string) {
  const tab = useSessionStore.getState().tabs.find(item => item.id === tabId);
  const panes = tab && isSessionTab(tab) ? leaves(tab.layout).map(pane => pane.id) : [];
  const blocks = useBlockStore.getState().byTab;
  return [...new Set([tabId, ...panes])].flatMap(id => blocks[id] ?? [])
    .sort((first, second) => (first.startedAt ?? 0) - (second.startedAt ?? 0));
}

/**
 * Collect the generation context. Returns null when the signal is too thin (the sufficiency check
 * lives here); `force` relaxes it for the user-triggered regenerate.
 */
function gatherContext(tabId: string, force = false): { prompt: string } | null {
  const blocks = sessionBlocks(tabId);
  const doneCmds = blocks
    .filter((b) => (b.status === 'done' || b.status === 'interrupted') && b.command)
    .map((b) => b.command);
  const msgs = useChatStore.getState().byTab[tabId] ?? [];
  const firstQ = msgs.find((m) => m.role === 'user' && m.content.trim());
  const firstA = msgs.find(
    (m) => m.role === 'assistant' && !m.pending && m.content.trim().length >= TITLE_MIN_ANSWER_CHARS,
  );
  if (!force && doneCmds.length < TITLE_MIN_DONE_BLOCKS && !firstA) return null;
  if (force && !doneCmds.length && !firstQ) return null;
  const last = [...blocks].reverse().find((b) => b.command);
  const parts: string[] = [];
  if (last?.cwd) parts.push(`工作目录：${last.cwd}`);
  if (last?.gitBranch) parts.push(`Git 分支：${last.gitBranch}`);
  if (doneCmds.length) parts.push('最近执行的命令：\n' + doneCmds.slice(-6).join('\n'));
  if (firstQ) parts.push('用户提问：' + firstQ.content.slice(0, 200));
  if (firstA) parts.push('AI 回答摘要：' + firstA.content.slice(0, 200));
  return { prompt: parts.join('\n\n') };
}

/**
 * No-AI fallback: the first user-message line, else the first meaningful command label, else the
 * git branch / cwd basename.
 */
export function heuristicTitle(tabId: string): string {
  const msgs = useChatStore.getState().byTab[tabId] ?? [];
  const firstQ = msgs.find((m) => m.role === 'user' && m.content.trim());
  if (firstQ) {
    const line = firstQ.content.trim().split('\n')[0] ?? '';
    const title = sanitizeTitle(line);
    if (title) return title;
  }
  const blocks = sessionBlocks(tabId);
  for (const block of blocks) {
    if (!block.command) continue;
    const label = normalizeCommandForTitle(block.command);
    if (label) return truncateTitle(label, MAX_TITLE_LEN);
  }
  const last = [...blocks].reverse().find((b) => b.gitBranch || b.cwd);
  if (last?.gitBranch) return sanitizeTitle(last.gitBranch);
  if (last?.cwd) return sanitizeTitle(last.cwd.split(/[/\\]/).filter(Boolean).pop() ?? '');
  return '';
}

/** Conditions + generation. `options` widens the trigger for the scale / user-triggered paths. */
export async function maybeAutoTitle(
  tabId: string,
  now = Date.now(),
  options: AutoTitleOptions = {},
): Promise<boolean> {
  const settings = useAgentSettings.getState().resolve();
  if (!settings.autoTitle) return false;
  const tab = useSessionStore.getState().tabs.find((t) => t.id === tabId);
  if (!tab || !isSessionTab(tab)) return false;
  if (tab.titleSource === 'manual' && !options.allowManual) return false;
  if (!options.bypassCooldown && now - (lastAttempt.get(tabId) ?? -Infinity) < TITLE_COOLDOWN_MS) return false;
  const ctx = gatherContext(tabId, Boolean(options.allowManual));
  if (!ctx) return false;
  lastAttempt.set(tabId, now);
  const markTitled = () => titledCount.set(tabId, (useChatStore.getState().byTab[tabId] ?? []).length);
  // Regenerate keeps the title automatic so later activity can still improve it; only a manual
  // rename locks a title.
  const applyTitle = (title: string) =>
    useSessionStore.getState().autoTitle(tabId, title, { allowManual: options.allowManual });
  // No API key: heuristic summary.
  if (!isApiKeyConfigured()) {
    const title = heuristicTitle(tabId);
    if (!title) return false;
    applyTitle(title);
    markTitled();
    return true;
  }
  try {
    const active = activeModelProfile();
    const model = createChatModel({
      provider: active.provider,
      baseUrl: active.baseUrl,
      model: settings.titleModel || active.model,
    });
    const { text } = await generateText({
      model,
      prompt:
        '你是终端会话标题生成器。根据下面的会话线索，用不超过 12 个字的中文概括这个会话在做什么。' +
        '只输出标题本身：不要引号、书名号、句号或解释，优先体现任务目标而不是命令名。\n\n' +
        ctx.prompt,
    });
    const title = sanitizeTitle(text);
    if (!title) return false;
    applyTitle(title);
    markTitled();
    return true;
  } catch (e) {
    console.warn('[title] 智能标题生成失败:', e);
    return false;
  }
}

/** Force a fresh title (session context menu): skip the cooldown, manual guard and sufficiency. */
export async function regenerateTitle(tabId: string): Promise<boolean> {
  lastAttempt.delete(tabId);
  return maybeAutoTitle(tabId, Date.now(), { bypassCooldown: true, allowManual: true });
}

/** Activity → reset the idle debounce timer. */
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

/** Subscribe to block/chat content changes; returns an unsubscribe (App.tsx wires it once). */
export function initAutoTitle(): () => void {
  const unBlocks = useBlockStore.subscribe((s, prev) => {
    for (const paneId of Object.keys(s.byTab)) {
      if (s.byTab[paneId] === prev.byTab[paneId]) continue;
      const owner = useSessionStore.getState().tabs.find(tab => isSessionTab(tab)
        && (tab.id === paneId || leaves(tab.layout).some(pane => pane.id === paneId)));
      if (owner) noteActivity(owner.id);
    }
  });
  const unChat = useChatStore.subscribe((s, prev) => {
    for (const tabId of Object.keys(s.byTab)) {
      if (!useSessionStore.getState().tabs.some(tab => tab.id === tabId && isSessionTab(tab))) continue;
      if (s.byTab[tabId] !== prev.byTab[tabId]) {
        noteActivity(tabId);
        // Once the conversation reaches a new scale, generate a fresh title (heuristic without AI).
        const count = s.byTab[tabId]?.length ?? 0;
        const last = titledCount.get(tabId) ?? 0;
        if (count >= TITLE_RETITLE_STEP && count - last >= TITLE_RETITLE_STEP) {
          clearTimeout(timers.get(tabId));
          void maybeAutoTitle(tabId, Date.now(), { bypassCooldown: true });
        }
      }
    }
  });
  // Drop a closed tab's cooldown / count / timer so the maps do not grow forever.
  const unWorkspace = useSessionStore.subscribe((s, prev) => {
    if (s.tabs === prev.tabs) return;
    const alive = new Set(s.tabs.map((t) => t.id));
    for (const tabId of [...lastAttempt.keys()]) {
      if (!alive.has(tabId)) lastAttempt.delete(tabId);
    }
    for (const tabId of [...titledCount.keys()]) {
      if (!alive.has(tabId)) titledCount.delete(tabId);
    }
    for (const tabId of [...timers.keys()]) {
      if (!alive.has(tabId)) {
        clearTimeout(timers.get(tabId));
        timers.delete(tabId);
      }
    }
  });
  return () => {
    unBlocks();
    unChat();
    unWorkspace();
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
  };
}

/** Test helper: clear the cooldown timers and debounce timers. */
export function resetTitleState() {
  lastAttempt.clear();
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
}
