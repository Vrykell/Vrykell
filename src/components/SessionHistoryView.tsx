import { useCallback, useEffect, useRef, useState } from 'react';
import { Monitor, RotateCcw, History, Trash2, ChevronRight, Folder, Server, Search, Filter, Check } from 'lucide-react';
import { listSessions } from '../api/session';
import { groupsList, groupRestore, groupDeleteWithSessions } from '../api/group';
import type { BackendSessionEntry, BackendGroupEntry } from '../search/types';
import { filterSessions, isSshSession, type SessionDateFilter, type SessionTypeFilter } from './sessionFilter';
import * as sessionManager from '../lib/sessionManager';
import { useWorkspaceStore } from '../store/workspace';
import { useToastStore } from './Toast';

const TYPE_OPTIONS: { value: SessionTypeFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'local', label: '本地' },
  { value: 'ssh', label: 'SSH' },
];

const DATE_OPTIONS: { value: SessionDateFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'today', label: '今天' },
  { value: '7d', label: '近7天' },
  { value: '30d', label: '近30天' },
  { value: '90d', label: '近90天' },
];

interface SessionFilterState {
  query: string;
  type: SessionTypeFilter;
  date: SessionDateFilter;
}

/** 筛选状态记忆在 sessionStorage（会话内保留，应用重启后不跨启动持久化）。 */
const FILTER_KEY = 'vrykell-session-history-filter';

function loadFilter(): SessionFilterState {
  try {
    const raw = sessionStorage.getItem(FILTER_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<SessionFilterState>;
      return {
        query: typeof p.query === 'string' ? p.query : '',
        type: TYPE_OPTIONS.some((o) => o.value === p.type) ? p.type! : 'all',
        date: DATE_OPTIONS.some((o) => o.value === p.date) ? p.date! : 'all',
      };
    }
  } catch { /* 缓存损坏/不可用 → 默认 */ }
  return { query: '', type: 'all', date: 'all' };
}

function saveFilter(f: SessionFilterState): void {
  try {
    sessionStorage.setItem(FILTER_KEY, JSON.stringify(f));
  } catch { /* 忽略 */ }
}

/**
 * SessionHistoryView — 「会话历史查看」标签页内容。
 * 按分组浏览历史会话；分组可「恢复分组」（重建组内全部历史会话为标签页）
 * 或「删除分组及历史」（删除组 + 组内全部会话）。
 */
export default function SessionHistoryView() {
  const [sessions, setSessions] = useState<BackendSessionEntry[]>([]);
  const [groups, setGroups] = useState<BackendGroupEntry[]>([]);
  const [loading, setLoading] = useState(true);
  // 历史页分组折叠状态（覆盖后端 collapsed，会话内本地态）
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  // 筛选（搜索 + 类型 + 日期）：记忆在 sessionStorage，跨启动不持久化
  const [filter, setFilterState] = useState<SessionFilterState>(loadFilter);
  const [filterMenu, setFilterMenu] = useState<{ x: number; y: number } | null>(null);

  const setFilter = (patch: Partial<SessionFilterState>) => {
    setFilterState((prev) => {
      const next = { ...prev, ...patch };
      saveFilter(next);
      return next;
    });
  };
  const { query, type: typeFilter, date: dateFilter } = filter;
  // 订阅标签面板的分组状态：归档/恢复分组后自动刷新历史列表
  const activeGroups = useWorkspaceStore((s) => s.groups);

  const toggleCollapsed = useCallback((id: string, initial: boolean) => {
    setCollapsed((prev) => ({ ...prev, [id]: !(prev[id] ?? initial) }));
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([listSessions(), groupsList()])
      .then(([ss, gs]) => { setSessions(ss); setGroups(gs); })
      .catch(() => { setSessions([]); setGroups([]); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load, activeGroups]);

  const openSession = useCallback((s: BackendSessionEntry) => {
    const ws = useWorkspaceStore.getState();
    if (s.status === 'historical') {
      sessionManager.restore(s.id, s.title).catch((e) => {
        console.warn('SessionHistoryView restore failed:', e);
      });
      return;
    }
    if (ws.tabs.some((t) => t.id === s.id)) {
      ws.activate(s.id);
    } else {
      sessionManager.restore(s.id, s.title).catch((e) => {
        console.warn('SessionHistoryView activate failed:', e);
      });
    }
  }, []);

  const deleteSession = useCallback((s: BackendSessionEntry) => {
    sessionManager.remove(s.id)
      .then(() => load())
      .catch((e) => console.warn('SessionHistoryView delete failed:', e));
  }, [load]);

  const restoreGroup = useCallback(async (g: BackendGroupEntry) => {
    try {
      await groupRestore(g.id);
      const all = await listSessions();
      const groupSessions = all
        .filter((s) => s.group_id === g.id)
        .sort((a, b) => a.sort_order - b.sort_order);
      // 先把分组加入 store，避免组内标签在 loadGroups 完成前短暂不可见
      const ws = useWorkspaceStore.getState();
      if (!ws.groups.some((x) => x.id === g.id)) {
        useWorkspaceStore.setState((s) => ({
          groups: [...s.groups, { id: g.id, title: g.title, collapsed: g.collapsed }],
        }));
      }
      // 逐个恢复会话，带上 groupId 保持嵌套关系（而不是恢复成自由标签 + 空组）
      for (const s of groupSessions) {
        await sessionManager.restore(s.id, s.title, { groupId: g.id });
      }
      // 分组恢复为活跃，标签面板需重新加载分组（含折叠态）
      await useWorkspaceStore.getState().loadGroups();
      useToastStore.getState().addToast(`已恢复分组「${g.title}」`, 'success');
    } catch (e) {
      useToastStore.getState().addToast(String((e as Error)?.message ?? e), 'error');
    }
    load();
  }, [load]);

  const deleteGroup = useCallback(async (g: BackendGroupEntry) => {
    const ok = window.confirm(`删除分组「${g.title}」及其全部会话历史？此操作不可恢复。`);
    if (!ok) return;
    try {
      await groupDeleteWithSessions(g.id);
      useToastStore.getState().addToast(`已删除分组「${g.title}」`, 'success');
    } catch (e) {
      useToastStore.getState().addToast(String((e as Error)?.message ?? e), 'error');
    }
    load();
  }, [load]);

  // 会话历史页只展示「历史（已关闭）」会话；组内/未分组按 sort_order 排序
  const hasFilter = typeFilter !== 'all' || dateFilter !== 'all';
  const historical = filterSessions(
    sessions.filter((s) => s.status === 'historical'),
    query,
    typeFilter,
    dateFilter,
  );
  const groupSessions = (gid: string) =>
    historical.filter((s) => s.group_id === gid).sort((a, b) => a.sort_order - b.sort_order);
  const ungrouped = historical.filter((s) => !s.group_id).sort((a, b) => a.sort_order - b.sort_order);

  return (
    <div style={{
      flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column',
      background: 'var(--surface)', userSelect: 'none',
    }}>
      {/* 顶栏：标题 + 搜索栏（内置筛选按钮）+ 刷新 */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 16px', borderBottom: '1px solid var(--border)',
        fontSize: 12, color: 'var(--text-secondary)',
      }}>
        <History size={13} />
        <span style={{ fontWeight: 600, color: 'var(--text-primary)', flexShrink: 0 }}>会话历史</span>
        <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>· {historical.length} 个会话</span>

        {/* 搜索栏（含筛选按钮） */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 4,
          flex: 1, minWidth: 140,
          background: 'var(--block)', borderRadius: 6, padding: '0 4px 0 8px', height: 26,
        }}>
          <Search size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <input
            value={query}
            onChange={(e) => setFilter({ query: e.target.value })}
            placeholder="搜索标题 / SSH 目标…"
            data-testid="session-filter-input"
            style={{
              flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none',
              fontSize: 12, color: 'var(--text-primary)', fontFamily: 'var(--font-ui)',
            }}
          />
          <button
            onClick={(e) => {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              setFilterMenu({ x: r.left, y: r.bottom + 4 });
            }}
            title={hasFilter ? '筛选（当前已启用，点击调整）' : '筛选'}
            data-testid="session-filter-btn"
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 22, height: 22, padding: 0, border: 'none', borderRadius: 4,
              background: 'transparent', cursor: 'pointer',
              color: hasFilter ? 'var(--accent)' : 'var(--text-muted)',
            }}
          >
            <Filter size={13} />
          </button>
        </div>

        <button
          onClick={load}
          title="刷新"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            fontSize: 11, padding: '3px 8px', border: '1px solid var(--border)',
            borderRadius: 4, background: 'transparent', color: 'var(--text-secondary)',
            cursor: 'pointer', flexShrink: 0,
          }}
        >
          <RotateCcw size={11} /> 刷新
        </button>
      </div>

      {/* 筛选弹层 */}
      {filterMenu && (
        <SessionFilterMenu
          anchor={filterMenu}
          value={{ type: typeFilter, date: dateFilter }}
          onChange={setFilter}
          onClose={() => setFilterMenu(null)}
        />
      )}

      {/* 列表 */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 8px 8px' }}>
        {loading ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>加载中…</div>
        ) : historical.length === 0 ? (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
            paddingTop: '14vh', color: 'var(--text-muted)', fontSize: 12,
          }}>
            <Monitor size={22} style={{ opacity: 0.4 }} />
            <span>暂无历史会话</span>
          </div>
        ) : (
          <>
            {groups.map((g) => {
              const gs = groupSessions(g.id);
              if (gs.length === 0) return null;
              const isCollapsed = collapsed[g.id] ?? g.collapsed;
              return (
                <div key={g.id} style={{ marginBottom: 4 }}>
                  {/* 分组容器 + 分组头 + 组内会话，结构对齐标签面板 */}
                  <div className="tab-group-container" style={{ overflow: 'hidden' }}>
                    <div
                      className="tab-group-header"
                      onClick={() => toggleCollapsed(g.id, g.collapsed)}
                      title="点击折叠/展开"
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '6px 8px', minHeight: 40, cursor: 'pointer',
                      }}
                    >
                      <span style={{
                        width: 24, height: 24, borderRadius: 6, flexShrink: 0,
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        background: 'var(--hover)', color: 'var(--text-secondary)',
                      }}>
                        <Folder size={14} />
                      </span>
                      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <span style={{
                          fontSize: 12, fontWeight: 600, color: 'var(--text-primary)',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {g.title}
                        </span>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{gs.length} 个会话</span>
                      </span>
                      <button
                        data-subtle
                        title="恢复分组（重建组内历史会话为标签页）"
                        onClick={(e) => { e.stopPropagation(); void restoreGroup(g); }}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          fontSize: 11, padding: '2px 8px', border: '1px solid var(--border)',
                          borderRadius: 4, background: 'transparent', color: 'var(--text-secondary)',
                          cursor: 'pointer',
                        }}
                      >
                        <RotateCcw size={11} /> 恢复
                      </button>
                      <button
                        data-subtle
                        title="删除分组及其全部会话历史"
                        onClick={(e) => { e.stopPropagation(); void deleteGroup(g); }}
                        style={{
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          width: 22, height: 22, padding: 0, border: 'none', borderRadius: 4,
                          background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer',
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--error-light)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
                      >
                        <Trash2 size={12} />
                      </button>
                      <ChevronRight
                        size={13}
                        style={{
                          color: 'var(--text-muted)', flexShrink: 0,
                          transition: 'transform 0.12s ease',
                          transform: isCollapsed ? 'none' : 'rotate(90deg)',
                        }}
                      />
                    </div>

                    {/* 组内会话与组内标签一样左缩进 12px，体现层级 */}
                    {!isCollapsed && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '0 0 4px' }}>
                        {gs.map((s) => (
                          <div key={s.id} style={{ padding: '0 4px 0 12px' }}>
                            <SessionRow
                              s={s}
                              onOpen={() => openSession(s)}
                              onDelete={s.status === 'historical' ? () => deleteSession(s) : undefined}
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {ungrouped.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {groups.length > 0 && (
                  <div style={{ padding: '0 8px 2px', fontSize: 11, color: 'var(--text-muted)' }}>未分组</div>
                )}
                {ungrouped.map((s) => (
                  <SessionRow
                    key={s.id}
                    s={s}
                    onOpen={() => openSession(s)}
                    onDelete={s.status === 'historical' ? () => deleteSession(s) : undefined}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** 筛选弹层：类型 / 日期 分组单选，点击选项即时生效（点外部或 Esc 关闭）。 */
function SessionFilterMenu({ anchor, value, onChange, onClose }: {
  anchor: { x: number; y: number };
  value: { type: SessionTypeFilter; date: SessionDateFilter };
  onChange: (patch: Partial<SessionFilterState>) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    requestAnimationFrame(() => document.addEventListener('mousedown', onDown));
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const top = Math.min(anchor.y, window.innerHeight - 190);
  const left = Math.min(anchor.x, window.innerWidth - 160);

  return (
    <div
      ref={ref}
      data-testid="session-filter-menu"
      style={{
        position: 'fixed', zIndex: 9999, top, left, minWidth: 150,
        background: 'var(--elevated)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-inner)', boxShadow: 'var(--shadow-md)',
        padding: '4px 0', fontSize: 12,
      }}
    >
      <div style={{ padding: '4px 10px 2px', fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.04em' }}>
        类型
      </div>
      {TYPE_OPTIONS.map((o) => {
        const active = o.value === value.type;
        return (
          <FilterOption key={o.value} label={o.label} active={active} onClick={() => onChange({ type: o.value })} />
        );
      })}
      <div style={{ height: 1, background: 'var(--border)', margin: '4px 8px' }} />
      <div style={{ padding: '4px 10px 2px', fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.04em' }}>
        日期
      </div>
      {DATE_OPTIONS.map((o) => {
        const active = o.value === value.date;
        return (
          <FilterOption key={o.value} label={o.label} active={active} onClick={() => onChange({ date: o.value })} />
        );
      })}
    </div>
  );
}

/** 筛选菜单单选行（选中打勾 + 强调色）。 */
function FilterOption({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
        padding: '5px 10px', border: 'none', background: 'transparent', cursor: 'pointer',
        color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
        fontSize: 12,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--hover)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      <span style={{ flex: 1 }}>{label}</span>
      {active && <Check size={12} style={{ color: 'var(--accent)', flexShrink: 0 }} />}
    </button>
  );
}

/** 从 payload 解析 SSH 目标（user@host），非 SSH 会话返回 null。 */
function sshTargetOf(s: BackendSessionEntry): string | null {
  if (s.kind !== 'ssh') return null;
  try {
    const p = JSON.parse(s.payload) as { ssh?: { host?: string; user?: string | null } };
    const host = p.ssh?.host;
    if (!host) return null;
    const user = p.ssh?.user;
    return user ? `${user}@${host}` : host;
  } catch {
    return null;
  }
}

function SessionRow({
  s, onOpen, onDelete,
}: { s: BackendSessionEntry; onOpen: () => void; onDelete?: () => void }) {
  const historical = s.status === 'historical';
  const [hovered, setHovered] = useState(false);
  const when = historical && s.closed_at
    ? `已关闭 · ${new Date(s.closed_at).toLocaleDateString()}`
    : '活跃中';
  const sshTarget = sshTargetOf(s);
  return (
    <div
      onClick={onOpen}
      title={historical ? '点击恢复此会话' : '点击切换到该会话'}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: 8, borderRadius: 'var(--tab-radius)', cursor: 'pointer',
        border: '1px solid transparent',
        background: hovered ? 'var(--tab-hover)' : 'transparent',
        transition: 'background 0.12s ease',
      }}
    >
      <span style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 24, height: 24, borderRadius: 6, flexShrink: 0,
        background: historical ? 'var(--hover)' : 'var(--success-bg)',
        color: historical ? 'var(--text-muted)' : 'var(--success)',
      }}>
        {isSshSession(s) ? <Server size={14} /> : historical ? <History size={14} /> : <Monitor size={14} />}
      </span>
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span style={{
          display: 'block', fontSize: 12, color: 'var(--text-primary)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {s.title || '(未命名会话)'}
        </span>
        <span style={{
          display: 'block', fontSize: 11, color: 'var(--text-muted)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {sshTarget ? `${when} · ${sshTarget}` : `${when} · ${s.block_count} 个命令块`}
        </span>
      </span>
      <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>
        {historical ? '恢复' : '打开'}
      </span>
      {onDelete && (
        <button
          data-subtle
          title="删除此会话"
          data-testid={`session-delete-${s.id}`}
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 20, height: 20, padding: 0, border: 'none', borderRadius: 4,
            background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer',
            flexShrink: 0, opacity: hovered ? 1 : 0, transition: 'opacity 0.12s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--button-hover)';
            e.currentTarget.style.color = 'var(--error-light)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = 'var(--text-muted)';
          }}
        >
          <Trash2 size={12} />
        </button>
      )}
    </div>
  );
}
