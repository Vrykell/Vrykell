/**
 * context — code-agent 式的上下文管理。
 *
 * 三种策略（对应 agentSettings.contextStrategy）：
 *   - off     ：全量，不裁剪
 *   - window  ：按 token 预算从最新往回保留（保底保留最新一条提问）
 *   - compact ：超预算时把被丢弃的旧消息压缩成「运行摘要」作为 system 上下文
 *
 * token 用轻量启发式估算（CJK ≈ 1 token/字，其余 ≈ 4 字符/token），不依赖 tokenizer。
 * 摘要按 tabId 做增量缓存：只有新增溢出的消息才重新摘要，会话内不重复折叠。
 */
import { generateText, type LanguageModel, type ModelMessage } from 'ai';
import type { ContextStrategy } from '@features/agent/agentSettings';

/** 一张图片的粗略 token 估算（不同模型差异大，这里取 512×512 常见档位） */
export const IMAGE_TOKEN_ESTIMATE = 1105;

export interface SizedMessage {
  msg: ModelMessage;
  tokens: number;
}

export interface PlanContextOptions {
  sized: SizedMessage[];
  strategy: ContextStrategy;
  /** 上下文 token 预算；0 = 不设限 */
  maxTokens: number;
  /** 摘要长度上限（token） */
  summaryTokens: number;
  model: LanguageModel;
  tabId?: string;
  signal?: AbortSignal;
}

export interface PlanContextResult {
  /** 非空时作为 system 上下文（compact 摘要） */
  system?: string;
  messages: ModelMessage[];
}

/** CJK 友好 token 估算。 */
export function estimateTokens(text: string): number {
  let t = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    // CJK 统一表意 / 假名 / 谚文 / 全角标点 → 1 token/字
    const cjk =
      (code >= 0x3000 && code <= 0x9fff) ||
      (code >= 0xff00 && code <= 0xffef) ||
      (code >= 0xac00 && code <= 0xd7af);
    t += cjk ? 1 : 0.25;
  }
  return Math.ceil(t);
}

// ── 增量摘要缓存（按 tabId） ──

interface CompactionCacheEntry {
  foldedCount: number;
  fingerprint: string;
  summary: string;
}

const compactionCache = new Map<string, CompactionCacheEntry>();

/** 关闭 tab 时清理摘要缓存（由 chat store dropTab 调用）。 */
export function clearCompactionCache(tabId: string) {
  compactionCache.delete(tabId);
}

function hashText(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return String(h >>> 0);
}

function messageText(s: SizedMessage): string {
  const m = s.msg;
  let content: string;
  if (typeof m.content === 'string') {
    content = m.content;
  } else if (Array.isArray(m.content)) {
    content = m.content
      .map((p) => (p && typeof p === 'object' && 'text' in p ? (p as { text: string }).text : '[图片/附件]'))
      .join('\n');
  } else {
    content = '';
  }
  const role = m.role === 'user' ? '用户' : m.role === 'assistant' ? '助手' : '系统';
  return `[${role}]\n${content}`;
}

async function summarize(
  items: SizedMessage[],
  prev: string | null,
  maxTokens: number,
  model: LanguageModel,
  signal?: AbortSignal,
): Promise<string | null> {
  const content = items.map(messageText).join('\n\n');
  const prompt = [
    '你是对话上下文压缩器。把下面的历史对话与工具活动压缩成一段简洁的运行摘要，保留：任务目标、已完成步骤、关键结论/决策、待办、重要文件路径与命令结果。',
    prev ? `\n【已有摘要（在此基础上合并更新，不要重复啰嗦）】\n${prev}` : '',
    `\n【需要压缩（或合并）的内容】\n${content}`,
    '只输出摘要正文（中文），不要解释。',
  ]
    .filter(Boolean)
    .join('\n');
  try {
    const { text } = await generateText({
      model,
      prompt,
      abortSignal: signal,
      maxOutputTokens: Math.max(64, maxTokens),
    });
    const t = text.trim();
    return t || null;
  } catch (e) {
    if ((e as { name?: string })?.name === 'AbortError' || signal?.aborted) throw e;
    console.warn('[context] 摘要生成失败，降级为窗口裁剪:', e);
    return null;
  }
}

async function buildSummary(
  dropped: SizedMessage[],
  summaryTokens: number,
  model: LanguageModel,
  tabId: string | undefined,
  signal: AbortSignal | undefined,
): Promise<string | null> {
  if (tabId) {
    const cached = compactionCache.get(tabId);
    const foldedCount = cached?.foldedCount ?? 0;
    if (cached && foldedCount > 0 && foldedCount <= dropped.length) {
      const fp = hashText(dropped.slice(0, foldedCount).map(messageText).join('\n\n'));
      if (fp === cached.fingerprint) {
        // 已折叠部分未变：只折叠新增的溢出消息
        const fresh = dropped.slice(foldedCount);
        if (fresh.length === 0) return cached.summary;
        const merged = await summarize(fresh, cached.summary, summaryTokens, model, signal);
        if (merged == null) return cached.summary;
        const nextEntry: CompactionCacheEntry = {
          foldedCount: dropped.length,
          fingerprint: hashText(dropped.map(messageText).join('\n\n')),
          summary: merged,
        };
        compactionCache.set(tabId, nextEntry);
        return merged;
      }
    }
    // 缓存缺失 / 已折叠部分被改动 → 全量重摘要
    const summary = await summarize(dropped, null, summaryTokens, model, signal);
    if (summary == null) return null;
    compactionCache.set(tabId, {
      foldedCount: dropped.length,
      fingerprint: hashText(dropped.map(messageText).join('\n\n')),
      summary,
    });
    return summary;
  }
  return summarize(dropped, null, summaryTokens, model, signal);
}

/** 按策略规划上下文：返回 (可选 system 摘要) + 最终要发送的消息。 */
export async function planContext(opts: PlanContextOptions): Promise<PlanContextResult> {
  const { sized, strategy, maxTokens, summaryTokens, model, tabId, signal } = opts;

  if (strategy === 'off' || maxTokens <= 0) {
    return { messages: sized.map((s) => s.msg) };
  }

  // 从最新往回累计，保留能放下的后缀；最新一条无条件保留
  let keep = sized.length;
  let used = 0;
  for (let i = sized.length - 1; i >= 0; i--) {
    const t = sized[i]!.tokens;
    if (i < sized.length - 1 && used + t > maxTokens) break;
    used += t;
    keep = i;
  }

  const kept = sized.slice(keep);
  const dropped = sized.slice(0, keep);

  if (strategy === 'window' || dropped.length === 0) {
    return { messages: kept.map((s) => s.msg) };
  }

  // compact：把 dropped 折叠成摘要
  const system = await buildSummary(dropped, summaryTokens, model, tabId, signal);
  const result: PlanContextResult = { messages: kept.map((s) => s.msg) };
  if (system) result.system = system;
  return result;
}
