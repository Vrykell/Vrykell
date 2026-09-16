/**
 * complete — 终端命令自动补全（M8）。
 *
 * 两级引擎（「无 AI 也要能工作」：本地级零网络零 key，始终可用）：
 *   1. 本地：命令历史前缀匹配（history store 热缓存，最近优先）→ 路径补全
 *      （末 token 像路径时 fs_list 列目录做前缀匹配）
 *   2. AI 增强：本地无结果且配了 key 时，generateText 生成补全
 *      （模型 = agentSettings.completeModel，空 = 沿用聊天模型）
 *
 * 返回的是「后缀」（接在当前输入后面的部分），调用方渲染 ghost text。
 * 全程可 abort（输入变化即作废上一次），任何失败静默返回 null。
 */
import { generateText } from 'ai';
import { invoke } from '@tauri-apps/api/core';
import { createChatModel } from '@features/agent/services/provider';
import { useAgentSettings } from '@features/agent/stores/agentSettings';
import { activeModelProfile, isApiKeyConfigured } from '@features/agent/stores/aiConfig';
import { useHistoryStore } from '@features/terminal/stores/history';

export interface CompleteOptions {
  cwd?: string;
}

/** 本地历史前缀匹配（同步，entries 已是最近优先）；返回后缀或 null */
export function localComplete(prefix: string): string | null {
  const hit = useHistoryStore
    .getState()
    .entries.find((e) => e.command.length > prefix.length && e.command.startsWith(prefix));
  return hit ? hit.command.slice(prefix.length) : null;
}

/** 本地历史前缀匹配的全部候选（同步，最近优先，按后缀去重）；返回后缀数组（无匹配为空数组） */
export function localCompleteCandidates(prefix: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of useHistoryStore.getState().entries) {
    if (e.command.length > prefix.length && e.command.startsWith(prefix)) {
      const suffix = e.command.slice(prefix.length);
      if (!seen.has(suffix)) {
        seen.add(suffix);
        out.push(suffix);
      }
    }
  }
  return out;
}

/** 末 token 是否为路径形态（绝对 / ./ ../ ~ 或含斜杠） */
export function looksLikePath(token: string): boolean {
  return (
    token.startsWith('/') ||
    token.startsWith('./') ||
    token.startsWith('../') ||
    token.startsWith('~/') ||
    token.includes('/')
  );
}

function lastToken(prefix: string): string {
  const m = /(\S+)$/.exec(prefix);
  return m ? m[1]! : '';
}

interface FsEntry {
  name: string;
  is_dir: boolean;
}

/**
 * 路径补全：解析末 token 的目录部分（绝对直接用，相对拼 cwd，~ 不展开直接放弃），
 * fs_list 后按名字前缀取第一个匹配。返回后缀（目录补结尾 /）或 null。
 */
export async function pathComplete(
  prefix: string,
  cwd: string | undefined,
  signal?: AbortSignal,
): Promise<string | null> {
  const token = lastToken(prefix);
  if (!looksLikePath(token)) return null;
  if (token.startsWith('~')) return null; // 前端不知 home，~ 交给 shell 自己
  const slash = token.lastIndexOf('/');
  const dirPart = token.slice(0, slash + 1);
  const base = token.slice(slash + 1);
  let dirAbs: string;
  if (dirPart.startsWith('/')) {
    dirAbs = dirPart;
  } else {
    if (!cwd) return null;
    dirAbs = cwd.replace(/\/+$/, '') + '/' + dirPart;
  }
  try {
    const entries = await invoke<FsEntry[]>('fs_list', { path: dirAbs });
    if (signal?.aborted) return null;
    const hit = entries.find(
      (e) => e.name.startsWith(base) && e.name !== base && (base.startsWith('.') || !e.name.startsWith('.')),
    );
    if (!hit) return null;
    return hit.name.slice(base.length) + (hit.is_dir ? '/' : '');
  } catch {
    return null; // 目录不可读等：静默降级
  }
}

/** AI 增强补全：本地无结果且有 key 时才走；模型需返回以前缀开头的完整命令 */
export async function aiComplete(
  prefix: string,
  opts: CompleteOptions,
  signal?: AbortSignal,
): Promise<string | null> {
  if (!isApiKeyConfigured()) return null;
  const settings = useAgentSettings.getState().resolve();
  const active = activeModelProfile();
  const recent = useHistoryStore.getState().entries.slice(0, 5).map((e) => e.command);
  try {
    const model = createChatModel({
      provider: active.provider,
      baseUrl: active.baseUrl,
      model: settings.completeModel || active.model,
    });
    const { text } = await generateText({
      model,
      abortSignal: signal,
      prompt: [
        '你是 shell 命令补全器。根据输入前缀，只输出补全后的完整命令（单行），不要解释、不要引号。',
        opts.cwd ? `当前目录：${opts.cwd}` : '',
        recent.length ? `最近命令：\n${recent.join('\n')}` : '',
        `输入前缀：${prefix}`,
      ]
        .filter(Boolean)
        .join('\n'),
    });
    if (signal?.aborted) return null;
    const line = (text.split('\n')[0] ?? '').trim();
    if (line.startsWith(prefix) && line.length > prefix.length) return line.slice(prefix.length);
    return null;
  } catch {
    return null; // 网络/中止/解析失败：静默
  }
}

/** 完整链路：本地历史 → 路径 → AI 增强；返回后缀或 null */
export async function completeCommand(
  prefix: string,
  opts: CompleteOptions,
  signal?: AbortSignal,
): Promise<string | null> {
  const local = localComplete(prefix);
  if (local) return local;
  const path = await pathComplete(prefix, opts.cwd, signal);
  if (path) return path;
  if (signal?.aborted) return null;
  return aiComplete(prefix, opts, signal);
}
