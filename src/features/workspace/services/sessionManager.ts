/**
 * Unified session lifecycle management.
 *
 * Every persistence operation for sessions and blocks goes through this module, which
 * wraps backend invoke calls and keeps the frontend stores in sync.
 */
import { useSessionStore, type Tab } from '@features/workspace';
import { useBlockStore } from '@features/terminal';
import { sanitizeOutputHtml } from '@utils/sanitizeHtml';
import { useChatStore } from '@features/chat';
import { deserializeParts } from '@features/agent/model/messageParts';
import { deserializeAttachments } from '@features/agent/model/attachments';
import { firstLeaf, leaf, parseWindowLayout, replaceLeaf, type WindowLayout } from '@features/workspace/model/windowLayout';
import { groupsList, sessionSetGroup } from '@platform/api/group';
import {
  createSession,
  archiveSession,
  restoreSession,
  updateSessionTitle,
  updateSessionCwd,
  updateSessionPayload,
  getSession,
  listSessions,
  deleteSession,
  recordBlock,
  getSessionBlocks,
  moveTerminalPanes,
  listChatMessages,
} from '@platform/api/session';
import { useToastStore } from '@ui/feedback/Toast';
import { t } from '@i18n';
import type { TermBlock } from '@features/terminal/services/pipeline/termBlock';
import type { BackendBlockEntry, BackendSessionEntry } from '@platform/api/types';

/** Metadata used to rebuild a tab when restoring a session (kind/payload are persisted by the backend). */
export interface RestoreMeta {
  /** Group id the restored tab belongs to (keeps nesting when a whole group is restored). */
  groupId?: string | null;
}

/** Parse the current session payload into the terminal pane tree. */
function parseLayout(payload: string, sessionId: string): WindowLayout {
  try {
    const parsed = JSON.parse(payload) as { layout?: unknown };
    const layout = parseWindowLayout(parsed.layout);
    if (layout) return layout;
  } catch {
    /* fall through to the single-pane fallback */
  }
  return leaf({ id: `${sessionId}#0`, kind: 'local' });
}

/** A session-level cwd remains a fallback until the first pane payload carries its own. */
function applySessionCwd(layout: WindowLayout, cwd: string): WindowLayout {
  const first = firstLeaf(layout);
  return first.cwd ? layout : replaceLeaf(layout, first.id, { ...first, cwd });
}

// ═══════════════════════════════════════════════════════════════
// Session lifecycle
// ═══════════════════════════════════════════════════════════════

/** Create a session (called when a tab is opened), carrying its kind discriminator and kind-specific JSON. */
export async function create(
  tabId: string,
  title: string,
  cwd?: string,
  kind = 'session',
  payload = '{}',
): Promise<void> {
  pendingSessions.set(tabId, { title, timestamp: Date.now(), cwd, kind, payload });
}

const pendingSessions = new Map<string, { title: string; timestamp: number; cwd?: string; kind: string; payload: string }>();
const sessionWrites = new Map<string, Promise<void>>();
const paneTransfers = new Map<string, Promise<void>>();

/** Serialize ownership changes with subsequent history writes and session closure. */
export function transferPanes(sourceId: string, targetId: string, paneIds: string[]): Promise<void> {
  useChatStore.setState(state => {
    const messages = state.byTab[sourceId] ?? [];
    const moves = (paneId?: string) => paneId ? paneIds.includes(paneId) : paneIds.includes(`${sourceId}#0`) || paneIds.includes(sourceId);
    const transferred = messages.filter(message => moves(message.paneId)).map(message => ({ ...message, paneId: message.paneId ?? paneIds[0] }));
    if (!transferred.length) return state;
    const target = state.byTab[targetId] ?? [];
    return { byTab: { ...state.byTab, [sourceId]: messages.filter(message => !moves(message.paneId)), [targetId]: [...target, ...transferred.filter(message => !target.some(item => item.id === message.id))] } };
  });
  const previous = Promise.all([paneTransfers.get(sourceId), paneTransfers.get(targetId)]);
  const operation = previous.then(async () => {
    const persisted = await persistedSessionIds([sourceId]);
    if (!persisted.has(sourceId)) return;
    await ensureContentSession(targetId);
    await moveTerminalPanes(sourceId, targetId, paneIds);
  });
  paneTransfers.set(sourceId, operation); paneTransfers.set(targetId, operation);
  void operation.finally(() => {
    if (paneTransfers.get(sourceId) === operation) paneTransfers.delete(sourceId);
    if (paneTransfers.get(targetId) === operation) paneTransfers.delete(targetId);
  }).catch(() => {});
  return operation;
}

export async function settlePaneTransfers(ids: readonly string[]) {
  await Promise.all(ids.map(id => paneTransfers.get(id)));
}
/** Group draft tabs in memory without creating empty history records. */
export async function persistedSessionIds(ids: readonly string[]): Promise<Set<string>> {
  await Promise.all(ids.map(id => sessionWrites.get(id) ?? Promise.resolve()));
  return new Set(ids.filter(id => !pendingSessions.has(id)));
}

export function ensureContentSession(tabId: string): Promise<void> {
  const pending = pendingSessions.get(tabId); if (!pending) return Promise.resolve();
  const existing = sessionWrites.get(tabId); if (existing) return existing;
  const tab = useSessionStore.getState().tabs.find(tab => tab.id === tabId);
  const write = createSession(tabId, tab?.title ?? pending.title, pending.timestamp, pending.cwd, pending.kind,
    tab?.kind === 'session' ? JSON.stringify({ layout: tab.layout }) : pending.payload)
    .then(async () => {
      const latest = pendingSessions.get(tabId);
      if (latest && latest !== pending) {
        if (latest.title !== pending.title) await updateSessionTitle(tabId, latest.title);
        if (latest.cwd !== pending.cwd) await updateSessionCwd(tabId, latest.cwd ?? '');
        if (latest.payload !== pending.payload) await updateSessionPayload(tabId, latest.payload);
      }
      const owner = useSessionStore.getState().tabs.find(item => item.id === tabId);
      if (owner?.kind === 'session' && owner.groupId) await sessionSetGroup(tabId, owner.groupId);
      pendingSessions.delete(tabId);
    })
    .finally(() => { sessionWrites.delete(tabId); });
  sessionWrites.set(tabId, write);
  return write;
}

/** Debounce timers for layout persistence (divider drags adjust the ratio at high frequency). */
const layoutTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Persist a window layout into the session payload (debounced). */
export function saveLayout(tabId: string, layout: WindowLayout): void {
  const draft = pendingSessions.get(tabId);
  if (draft) { pendingSessions.set(tabId, { ...draft, payload: JSON.stringify({ layout }) }); return; }
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

/** Update the session working directory (reported through OSC 7 after cd). */
export async function setCwd(tabId: string, cwd: string): Promise<void> {
  const draft = pendingSessions.get(tabId);
  if (draft) { pendingSessions.set(tabId, { ...draft, cwd }); return; }
  try {
    await updateSessionCwd(tabId, cwd);
  } catch (e) {
    console.warn('sessionManager.setCwd failed:', e);
  }
}

/** Close a session (called when a tab is closed - marks it historical). */
export async function close(tabId: string): Promise<void> {
  await paneTransfers.get(tabId);
  const pending = layoutTimers.get(tabId);
  if (pending) {
    clearTimeout(pending);
    layoutTimers.delete(tabId);
  }
  if (pendingSessions.has(tabId) && !sessionWrites.has(tabId)) { pendingSessions.delete(tabId); return; }
  await sessionWrites.get(tabId)?.catch(() => {});
  try {
    await archiveSession(tabId, Date.now());
  } catch (e) {
    console.warn('sessionManager.close failed:', e);
  }
}

/** Restore a session (undo close / restore from search - mark active, load blocks, add tab). */
export async function restore(sessionId: string, title: string, meta?: RestoreMeta): Promise<void> {
  let degraded = false;
  // Persist restoration before changing the visible workspace.
  await restoreSession(sessionId);

  // 2. Load every block of this session
  let backendBlocks: BackendBlockEntry[] = [];
  try {
    backendBlocks = await getSessionBlocks(sessionId);
  } catch (e) {
    degraded = true;
    console.warn('sessionManager.restore: get_session_blocks failed:', e);
  }

  // 3. Fill the block store (terminal ownership: a null pane_id or the main id maps to the
  // first terminal #0; anything else is kept as is)
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
        cwd: b.cwd || undefined,
        exitCode: b.exit_code,
        startedAt: b.started_at,
        endedAt: b.ended_at,
        status,
        wasLongRunning: false,
        // Stored content is untrusted (the database may have been tampered with): the
        // extracted HTML snapshot must be sanitized before it enters the render pipeline.
        outputHtml: sanitizeOutputHtml(b.output_html || ''),
        outputText: b.output_clean || '',
        outputRaw: b.output_raw,
        linesTruncated: 0,
      };
      bs.addBlock(paneId, block);
    }
  }

  // 3.5 Restore AI conversation messages (part of session state, not command blocks)
  try {
    const backendChat = await listChatMessages(sessionId);
    if (backendChat.length > 0) {
      const msgs = backendChat.map((c) => ({
        id: c.id,
        role: c.role as 'user' | 'assistant',
        content: c.content,
        // Empty or malformed parts fall back to plain text rendering.
        parts: deserializeParts(c.parts),
        // Attachment metadata (empty or malformed data -> undefined)
        attachments: deserializeAttachments(c.attachments),
        paneId: c.pane_id ?? undefined,
        createdAt: c.created_at,
      }));
      useChatStore.setState((s) => ({
        byTab: { ...s.byTab, [sessionId]: msgs },
      }));
    } else {
      useChatStore.getState().dropTab(sessionId);
    }
  } catch (e) {
    degraded = true;
    console.warn('sessionManager.restore: list_chat_messages failed:', e);
  }

  // 3.6 Fetch the full session record (cwd / kind / payload / group_id)
  let info: BackendSessionEntry | null = null;
  try {
    info = await getSession(sessionId);
  } catch (e) {
    console.warn('sessionManager.restore: get_session failed:', e);
  }
  if (info?.cwd) {
    for (const saved of backendBlocks) {
      if (saved.cwd) continue;
      const paneId = !saved.pane_id || saved.pane_id === sessionId ? `${sessionId}#0` : saved.pane_id;
      useBlockStore.getState().updateBlock(paneId, saved.id, { cwd: info.cwd });
    }
  }
  const parsedLayout = parseLayout(info?.payload ?? '{}', sessionId);
  const layout = info?.cwd ? applySessionCwd(parsedLayout, info.cwd) : parsedLayout;
  // Messages without an explicit pane belong to the first pane.
  const firstPaneId = firstLeaf(layout).id;
  useChatStore.setState((state) => {
    const messages = state.byTab[sessionId];
    if (!messages) return state;
    return { byTab: {
      ...state.byTab,
      [sessionId]: messages.map((message) => ({
        ...message, paneId: !message.paneId || message.paneId === sessionId ? firstPaneId : message.paneId,
      })),
    } };
  });
  const storedGroupId = info?.group_id ?? undefined;
  const hasGroupOverride = meta != null && Object.prototype.hasOwnProperty.call(meta, 'groupId');
  if (!hasGroupOverride && storedGroupId && !useSessionStore.getState().groups.some(group => group.id === storedGroupId)) {
    try {
      const group = (await groupsList()).find(item => item.id === storedGroupId);
      if (group) useSessionStore.setState(state => ({ groups: state.groups.some(item => item.id === group.id) ? state.groups
        : [...state.groups, { id: group.id, title: group.title, collapsed: false }] }));
    } catch (error) {
      degraded = true;
      console.warn('sessionManager.restore: groups_list failed:', error);
    }
  }
  const knownGroupIds = new Set(useSessionStore.getState().groups.map((group) => group.id));
  const groupId = hasGroupOverride
    ? meta.groupId ?? undefined
    : storedGroupId && knownGroupIds.has(storedGroupId) ? storedGroupId : undefined;

  // Only an explicit move changes persisted membership. A failed group lookup must not erase it.
  if (hasGroupOverride && (storedGroupId ?? null) !== (groupId ?? null)) {
    await sessionSetGroup(sessionId, groupId ?? null).catch((e) => {
      console.warn('sessionManager.restore: session_set_group failed:', e);
    });
  }

  // 4. Rebuild the window tab (including its layout) and make it active - restoring a
  // session restores its window layout.
  const tab: Tab = {
    id: sessionId,
    title: title || info?.title || '',
    kind: 'session',
    groupId,
    layout,
  };

  // Insert partial restores in the saved tab order even when history uses another sort.
  let groupOrder = new Map<string, number>();
  if (groupId && useSessionStore.getState().tabs.some(item => item.kind === 'session' && item.groupId === groupId)) {
    try {
      groupOrder = new Map((await listSessions()).filter(item => item.group_id === groupId).map(item => [item.id, item.sort_order]));
    } catch (error) {
      console.warn('sessionManager.restore: list_sessions failed:', error);
    }
  }

  const ws = useSessionStore.getState();
  if (!ws.tabs.some((t) => t.id === sessionId)) {
    useSessionStore.setState((state) => {
      const tabs = [...state.tabs];
      const before = groupId ? tabs.findIndex(item => item.kind === 'session' && item.groupId === groupId
        && (groupOrder.get(item.id) ?? -Infinity) > (info?.sort_order ?? Infinity)) : -1;
      let index = before;
      if (index < 0 && groupId) {
        for (let i = tabs.length - 1; i >= 0; i--) {
          const item = tabs[i];
          if (item.kind === 'session' && item.groupId === groupId) { index = i + 1; break; }
        }
      }
      tabs.splice(index < 0 ? tabs.length : index, 0, tab);
      return { tabs, activeId: sessionId };
    });
  } else {
    useSessionStore.setState((s) => ({
      tabs: s.tabs.map((existing) => existing.id === sessionId && existing.kind === 'session'
        ? { ...existing, groupId }
        : existing),
    }));
    ws.activate(sessionId);
  }

  if (degraded) {
    useToastStore.getState().addToast(t('Session "{{name}}" restored incompletely; some content could not be loaded.', { name: title || sessionId }), 'error');
  }
}

/** Rename a session. */
export async function rename(tabId: string, title: string): Promise<void> {
  const draft = pendingSessions.get(tabId);
  if (draft) { pendingSessions.set(tabId, { ...draft, title }); return; }
  try {
    await updateSessionTitle(tabId, title);
  } catch (e) {
    console.warn('sessionManager.rename failed:', e);
  }
}

/** Delete a session (cascading to its blocks and chat messages). Only call this for historical sessions. */
export async function remove(sessionId: string): Promise<void> {
  try {
    await deleteSession(sessionId);
  } catch (e) {
    console.warn('sessionManager.remove failed:', e);
    throw e;
  }
}

// ═══════════════════════════════════════════════════════════════
// Block persistence
// ═══════════════════════════════════════════════════════════════

/** Record a block (called once on start and once on complete - the backend upserts). */
export async function record(
  tabId: string,
  paneId: string,
  block: TermBlock,
  phase: 'start' | 'complete',
): Promise<void> {
  if (!block.command.trim() && !block.outputText.trim() && !block.outputRaw.trim()) return;
  try {
    await paneTransfers.get(tabId);
    await ensureContentSession(tabId);
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
      block.cwd ?? '',
    );
  } catch (e) {
    console.warn('sessionManager.record failed:', e);
  }
}

export { };
