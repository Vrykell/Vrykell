/**
 * sessionManager — 统一会话生命周期管理
 *
 * 所有会话/块的持久化操作都通过此模块，封装后端 invoke + 前端 store 同步。
 * 后续添加会话管理 UI 时，只需接入同一套 API。
 */
import { useWorkspaceStore, type Tab } from '../stores/workspace';
import { useBlockStore } from '../stores/blocks';
import { useChatStore } from '../stores/chat';
import {
  createSession,
  archiveSession,
  restoreSession,
  updateSessionTitle,
  updateSessionCwd,
  getSession,
  deleteSession,
  recordBlock,
  getSessionBlocks,
  setBlockCollapsed,
  listChatMessages,
} from '../api/session';
import type { TermBlock } from '../terminal/pipeline/termBlock';
import type { BackendBlockEntry, BackendSessionEntry } from '../search/types';
import type { ShellType } from './shells';

/** 恢复会话时用于重建 tab 的元数据（kind/payload 已由后端持久化）。 */
export interface RestoreMeta {
  /** 恢复为标签时归属的分组 id（恢复整组时保持嵌套关系） */
  groupId?: string;
}

/** 解析后端 payload JSON（变体专属字段）。 */
function parseSessionPayload(payload: string): {
  shellType?: string | null;
  ssh?: { name?: string; host?: string; user?: string | null; port?: number | null; connectionId?: string | null };
} | null {
  try {
    return JSON.parse(payload) as ReturnType<typeof parseSessionPayload>;
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// 会话生命周期
// ═══════════════════════════════════════════════════════════════

/** 创建会话（新建标签页时调用），携带类型判别与变体专属 JSON。 */
export async function create(
  tabId: string,
  title: string,
  cwd?: string,
  kind: 'local' | 'ssh' = 'local',
  payload = '{}',
): Promise<void> {
  try {
    await createSession(tabId, title, Date.now(), cwd, kind, payload);
  } catch (e) {
    console.warn('sessionManager.create failed:', e);
  }
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

  // 3. 填充 block store（按 pane 归属：pane_id 为 null/主 id → 主 pane；#2 → 副 pane）
  if (backendBlocks.length > 0) {
    const bs = useBlockStore.getState();
    // 先清空主/副 pane 的旧数据（避免重复）
    bs.clearBlocks(sessionId);
    bs.clearBlocks(`${sessionId}#2`);
    for (const b of backendBlocks) {
      const paneId = b.pane_id ?? sessionId;
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
        outputHtml: '',
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
  const cwd = info?.cwd || undefined;
  const kind = info?.kind === 'ssh' ? 'ssh' : 'local';
  const p = parseSessionPayload(info?.payload ?? '{}');

  // 4. 按 kind 重建 tab（追加到末尾），设置为 active；恢复 SSH 身份
  let tab: Tab;
  if (kind === 'ssh') {
    const ssh = p?.ssh ?? {};
    tab = {
      id: sessionId,
      title: title || info?.title || '',
      kind: 'ssh',
      groupId: meta?.groupId ?? info?.group_id ?? undefined,
      cwd,
      ssh: {
        name: ssh.name ?? '',
        host: ssh.host ?? '',
        user: ssh.user ?? undefined,
        port: ssh.port ?? undefined,
        connectionId: ssh.connectionId ?? undefined,
      },
    };
  } else {
    tab = {
      id: sessionId,
      title: title || info?.title || '',
      kind: 'local',
      groupId: meta?.groupId ?? info?.group_id ?? undefined,
      cwd,
      shellType: (p?.shellType as ShellType | undefined) ?? undefined,
    };
  }

  const ws = useWorkspaceStore.getState();
  if (!ws.tabs.some((t) => t.id === sessionId)) {
    useWorkspaceStore.setState((s) => ({
      tabs: [...s.tabs, tab],
      activeId: sessionId,
    }));
  } else {
    ws.activate(sessionId);
  }
  // 停靠布局由 useTerminalLayoutStore 全局管理（activate 会按需自动停靠）
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
