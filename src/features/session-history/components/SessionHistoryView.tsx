import { useCallback, useEffect, useRef, useState } from 'react';
import { Monitor, RotateCcw, History, Trash2, ChevronRight, Folder, Server, Search, Filter, Check } from '@ui/icons';
import type { BackendSessionEntry } from '@platform/api/types';
import {
  isSshSession,
  sshTargetOf,
  SESSION_DATE_OPTIONS,
  SESSION_TYPE_OPTIONS,
  useSessionHistory,
  type SessionDateFilter,
  type SessionHistoryFilter,
  type SessionTypeFilter,
} from '@features/session-history';
import { useToastStore } from '@ui/Toast';

const TYPE_OPTIONS = SESSION_TYPE_OPTIONS;

const DATE_OPTIONS = SESSION_DATE_OPTIONS;

type SessionFilterState = SessionHistoryFilter;

/**
 * SessionHistoryView — 「会话历史查看」标签页内容。
 * 按分组浏览历史会话；分组可「恢复分组」（重建组内全部历史会话为标签页）
 * 或「删除分组及历史」（删除组 + 组内全部会话）。
 */
export default function SessionHistoryView() {
  // 历史页分组折叠状态（覆盖后端 collapsed，会话内本地态）
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [filterMenu, setFilterMenu] = useState<{ x: number; y: number } | null>(null);
  const notify = useCallback((message: string, kind: 'success' | 'error') => {
    useToastStore.getState().addToast(message, kind);
  }, []);
  const {
    groups,
    loading,
    filter,
    setFilter,
    load,
    openSession,
    deleteHistoricalSession,
    restoreGroup,
    deleteGroup,
    historical,
    grouped,
    ungrouped,
    hasFilter,
  } = useSessionHistory({ notify });
  const { query, type: typeFilter, date: dateFilter } = filter;

  const toggleCollapsed = useCallback((id: string, initial: boolean) => {
    setCollapsed((prev) => ({ ...prev, [id]: !(prev[id] ?? initial) }));
  }, []);

  const groupSessions = useCallback((groupId: string) => grouped.get(groupId) ?? [], [grouped]);

  return (
    <div style={{
      flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column',
      background: 'var(--surface)', userSelect: 'none',
    }}>
      {/* 顶栏：标题 + 搜索栏（内置筛选按钮）+ 刷新 */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 16px', borderBottom: '1px solid var(--border)',
        fontSize: 'calc(12px * var(--ui-font-scale))', color: 'var(--text-secondary)',
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
              fontSize: 'calc(12px * var(--ui-font-scale))', color: 'var(--text-primary)', fontFamily: 'var(--font-ui)',
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
            fontSize: 'calc(11px * var(--ui-font-scale))', padding: '3px 8px', border: '1px solid var(--border)',
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
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 'calc(12px * var(--ui-font-scale))' }}>加载中…</div>
        ) : historical.length === 0 ? (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
            paddingTop: '14vh', color: 'var(--text-muted)', fontSize: 'calc(12px * var(--ui-font-scale))',
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
                          fontSize: 'calc(12px * var(--ui-font-scale))', fontWeight: 600, color: 'var(--text-primary)',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {g.title}
                        </span>
                        <span style={{ fontSize: 'calc(11px * var(--ui-font-scale))', color: 'var(--text-muted)' }}>{gs.length} 个会话</span>
                      </span>
                      <button
                        data-subtle
                        title="恢复分组（重建组内历史会话为标签页）"
                        onClick={(e) => { e.stopPropagation(); void restoreGroup(g); }}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          fontSize: 'calc(11px * var(--ui-font-scale))', padding: '2px 8px', border: '1px solid var(--border)',
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
                              onDelete={s.status === 'historical' ? () => deleteHistoricalSession(s) : undefined}
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
                  <div style={{ padding: '0 8px 2px', fontSize: 'calc(11px * var(--ui-font-scale))', color: 'var(--text-muted)' }}>未分组</div>
                )}
                {ungrouped.map((s) => (
                  <SessionRow
                    key={s.id}
                    s={s}
                    onOpen={() => openSession(s)}
                    onDelete={s.status === 'historical' ? () => deleteHistoricalSession(s) : undefined}
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
      className="workspace-floating"
      style={{
        position: 'fixed', zIndex: 9999, top, left, minWidth: 150,
        padding: 4, fontSize: 'calc(12px * var(--ui-font-scale))',
      }}
    >
      <div style={{ padding: '4px 10px 2px', fontSize: 'calc(10px * var(--ui-font-scale))', color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.04em' }}>
        类型
      </div>
      {TYPE_OPTIONS.map((o) => {
        const active = o.value === value.type;
        return (
          <FilterOption key={o.value} label={o.label} active={active} onClick={() => onChange({ type: o.value })} />
        );
      })}
      <div style={{ height: 1, background: 'var(--border)', margin: '4px 8px' }} />
      <div style={{ padding: '4px 10px 2px', fontSize: 'calc(10px * var(--ui-font-scale))', color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.04em' }}>
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
    <button className="workspace-floating-row"
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
        padding: '5px 10px', border: 'none', background: 'transparent', cursor: 'pointer',
        color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
        fontSize: 'calc(12px * var(--ui-font-scale))',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--hover)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      <span style={{ flex: 1 }}>{label}</span>
      {active && <Check size={12} style={{ color: 'var(--accent)', flexShrink: 0 }} />}
    </button>
  );
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
          display: 'block', fontSize: 'calc(12px * var(--ui-font-scale))', color: 'var(--text-primary)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {s.title || '(未命名会话)'}
        </span>
        <span style={{
          display: 'block', fontSize: 'calc(11px * var(--ui-font-scale))', color: 'var(--text-muted)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {sshTarget ? `${when} · ${sshTarget}` : `${when} · ${s.block_count} 个命令块`}
        </span>
      </span>
      <span style={{ fontSize: 'calc(11px * var(--ui-font-scale))', color: 'var(--text-muted)', flexShrink: 0 }}>
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
