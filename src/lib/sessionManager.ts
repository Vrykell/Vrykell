/**
 * sessionManager — 统一会话生命周期管理
 *
 * 所有会话/块的持久化操作都通过此模块，封装后端 invoke + 前端 store 同步。
 * 后续添加会话管理 UI 时，只需接入同一套 API。
 */
import { useSessionStore, type Tab } from '@entities/session';
import { useBlockStore } from '@entities/terminal';
import { sanitizeOutputHtml } from './sanitizeHtml';
import { useChatStore } from '@entities/chat';
import { deserializeParts } from '@features/agent/messageParts';
import { deserializeAttachments } from '@features/agent/attachments';
import { leaf, type WindowLayout } from './windowLayout';
import {
  createSession,
  archiveSession,
  restoreSession,
  updateSessionTitle,
  updateSessionCwd,
  updateSessionPayload,
  getSession,
  deleteSession,
  recordBlock,
  getSessionBlocks,
  setBlockCollapsed,
  listChatMessages,
} from '@/api/session';
import type { TermBlock } from '@features/terminal/pipeline/termBlock';
import type { BackendBlockEntry, BackendSessionEntry } from '@features/search/types';

/** 恢复会话时用于重建 tab 的元数据（kind/payload 已由后端持久化）。 */
export interface RestoreMeta {
  /** 恢复为标签时归属的分组 id（恢复整组时保持嵌套关系） */
  groupId?: string;
}

/** 解析后端 payload JSON → 窗口布局（兼容旧版 shellType/ssh 单终端 payload）。 */
function parseLayout(payload: string, sessionId: string): WindowLayout {
  try {
    const p = JSON.parse(payload) as {
      layout?: unknown;
      shellType?: string;
      ssh?: { name?: string; host?: string; user?: string | null; port?: number | null; connectionId?: string | null };
    };
    if (p.layout && typeof p.layout === 'object' && p.layout !== null) {
      return p.layout as WindowLayout;
    }
    if (p.ssh) {
      return leaf({
        id: `${sessionId}#0`, kind: 'ssh',
        ssh: { name: p.ssh.name ?? '', host: p.ssh.host ?? '', user: p.ssh.user ?? undefined, port: p.ssh.port ?? undefined, connectionId: p.ssh.connectionId ?? undefined },
      });
    }
    if (p.shellType) {
      return leaf({ id: `${sessionId}#0`, kind: 'local', shellType: p.shellType });
    }
  } catch {
    /* fallthrough */
  }
  return leaf({ id: `${sessionId}#0`, kind: 'local' });
}

// ═══════════════════════════════════════════════════════════════
// 会话生命周期
// ═══════════════════════════════════════════════════════════════

/** 创建会话（新建标签页时调用），携带类型判别与变体专属 JSON。 */
export async function create(
  tabId: string,
  title: string,
  cwd?: string,
  kind = 'session',
  payload = '{}',
): Promise<void> {
  try {
    await createSession(tabId, title, Date.now(), cwd, kind, payload);
  } catch (e) {
    console.warn('sessionManager.create failed:', e);
  }
}

/** 布局持久化的去抖计时器（分隔线拖拽会高频调整 ratio）。 */
const layoutTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** 持久化窗口布局到会话 payload（去抖）。 */
export function saveLayout(tabId: string, layout: WindowLayout): void {
  const pending = layoutTimers.get(tabId);
  if (pending) clearTimeout(pending);
  layoutTimers.set(
    tabId,
    setTimeout(() => {
      layoutTimers.delete(tabId);
      updateSessionPayload(tabId, JSON.stringify({ layout })).catch((e) => {
        console.warn('sessionManager.saveLayout failed:', e);
      });
    }, 150),
  );
}

/** 更新会话当前工作目录（cd 后 OSC 7 上报） */
export async function setCwd(tabId: string, cwd: string): Promise<void> {
  try {
    await updateSessionCwd(tabId, cwd);
  } catch (e) {
    console.warn('sessionManager.setCwd failed:', e);
  }
}

/** 关闭会话（关闭标签页时调用 — 标记为 historical） */
export async function close(tabId: string): Promise<void> {
  try {
    await archiveSession(tabId, Date.now());
  } catch (e) {
    console.warn('sessionManager.close failed:', e);
  }
}

/** 恢复会话（撤销关闭 / 搜索恢复 — 标记 active + 加载 blocks + 添加 tab）。 */
export async function restore(sessionId: string, title: string, meta?: RestoreMeta): Promise<void> {
  // 1. 后端标记 active
  await restoreSession(sessionId).catch((e) => {
    console.warn('sessionManager.restore: restore_session failed:', e);
  });

  // 2. 加载该会话所有 block
  let backendBlocks: BackendBlockEntry[] = [];
  try {
    backendBlocks = await getSessionBlocks(sessionId);
  } catch (e) {
    console.warn('sessionManager.restore: get_session_blocks failed:', e);
  }

  // 3. 填充 block store（按终端归属：pane_id 为 null/主 id → 首终端 #0；其余原样）
  if (backendBlocks.length > 0) {
    const bs = useBlockStore.getState();
    bs.clearBlocks(sessionId);
    bs.clearBlocks(`${sessionId}#0`);
    for (const b of backendBlocks) {
      const rawPane = b.pane_id ?? sessionId;
      const paneId = rawPane === sessionId ? `${sessionId}#0` : rawPane;
      const status: TermBlock['status'] =
        b.status === 'executing' || b.status === 'running'
          ? 'executing'
          : b.status === 'interrupted'
            ? 'interrupted'
            : 'done';
      const block: TermBlock = {
        id: b.id,
        command: b.command,
        exitCode: b.exit_code,
        startedAt: b.started_at,
        endedAt: b.ended_at,
        status,
        wasLongRunning: false,
        collapsed: b.collapsed || undefined,
        // 落库内容不可信（DB 可能被篡改）：取出的 HTML 快照必须先净化再进渲染管线
        outputHtml: sanitizeOutputHtml(b.output_html || ''),
        outputText: b.output_clean || '',
        outputRaw: b.output_raw,
        linesTruncated: 0,
      };
      bs.addBlock(paneId, block);
    }
  }

  // 3.5 恢复 AI 对话消息（会话状态的一部分，非命令块）
  try {
    const backendChat = await listChatMessages(sessionId);
    if (backendChat.length > 0) {
      const msgs = backendChat.map((c) => ({
        id: c.id,
        role: c.role as 'user' | 'assistant',
        content: c.content,
        // parts 渲染层（'' / 脏数据 → undefined，走 legacy 文本渲染）
        parts: deserializeParts(c.parts),
        // 附件元数据（M5；'' / 脏数据 → undefined）
        attachments: deserializeAttachments(c.attachments),
        // 旧持久化没有 paneId：仅面板可见，不进块流
        createdAt: c.created_at,
      }));
      useChatStore.setState((s) => ({
        byTab: { ...s.byTab, [sessionId]: msgs },
      }));
    } else {
      useChatStore.getState().dropTab(sessionId);
    }
  } catch (e) {
    console.warn('sessionManager.restore: list_chat_messages failed:', e);
  }

  // 3.6 取回会话完整信息（cwd / kind / payload / group_id）
  let info: BackendSessionEntry | null = null;
  try {
    info = await getSession(sessionId);
  } catch (e) {
    console.warn('sessionManager.restore: get_session failed:', e);
  }
  const layout = parseLayout(info?.payload ?? '{}', sessionId);

  // 4. 重建窗口 tab（含布局），设置为 active —— 恢复会话 = 恢复窗口布局
  const tab: Tab = {
    id: sessionId,
    title: title || info?.title || '',
    kind: 'session',
    groupId: meta?.groupId ?? info?.group_id ?? undefined,
    layout,
  };

  const ws = useSessionStore.getState();
  if (!ws.tabs.some((t) => t.id === sessionId)) {
    useSessionStore.setState((s) => ({
      tabs: [...s.tabs, tab],
      activeId: sessionId,
    }));
  } else {
    ws.activate(sessionId);
  }
}

/** 重命名会话 */
export async function rename(tabId: string, title: string): Promise<void> {
  try {
    await updateSessionTitle(tabId, title);
  } catch (e) {
    console.warn('sessionManager.rename failed:', e);
  }
}

/** 删除会话（级联删除 block / 聊天消息）。仅对历史会话调用。 */
export async function remove(sessionId: string): Promise<void> {
  try {
    await deleteSession(sessionId);
  } catch (e) {
    console.warn('sessionManager.remove failed:', e);
    throw e;
  }
}

// ═══════════════════════════════════════════════════════════════
// 块持久化
// ═══════════════════════════════════════════════════════════════

/** 持久化单个 block 的折叠/展开状态（block 恢复时回读）。 */
export async function persistBlockCollapsed(blockId: string, collapsed: boolean): Promise<void> {
  try {
    await setBlockCollapsed(blockId, collapsed);
  } catch (e) {
    console.warn('sessionManager.persistBlockCollapsed failed:', e);
  }
}

/** 记录 block（start 和 complete 各调一次 — 后端 UPSERT） */
export async function record(
  tabId: string,
  paneId: string,
  block: TermBlock,
  phase: 'start' | 'complete',
): Promise<void> {
  try {
    await recordBlock(
      block.id,
      tabId,
      paneId,
      block.command,
      phase === 'complete' ? block.outputRaw : '',
      phase === 'complete' ? block.outputText : '',
      phase === 'complete' ? block.outputHtml : '',
      phase === 'complete' ? block.exitCode : null,
      phase === 'start' ? 'executing' : block.status,
      block.startedAt ?? 0,
      phase === 'complete' ? block.endedAt : null,
    );
  } catch (e) {
    console.warn('sessionManager.record failed:', e);
  }
}

// ═══════════════════════════════════════════════════════════════
// 删除（预留）
// ═══════════════════════════════════════════════════════════════

/**
 * ⚠ 暂不实现
 * 删除会话及所有关联 block（级联删除）。
 * 若该会话仍有活跃 tab，需先关闭 tab。
 */
export { };
