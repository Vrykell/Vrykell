import { useEffect, useRef } from 'react';
import { Check } from '@ui/icons';
import type { ResultType } from '@features/search/types';
import { getSources, useEnabledSourcesStore, toggleSource } from '@features/search/services/registry';

interface Props {
  open: boolean;
  onClose: () => void;
  /** 各源的实时匹配数 */
  counts: Partial<Record<ResultType, number>>;
}

export default function FilterPopover({ open, onClose, counts }: Props) {
  const popoverRef = useRef<HTMLDivElement>(null);
  // 必须在 early return 之前调用（React hooks 顺序稳定，否则切换 open 时崩溃）
  const enabled = useEnabledSourcesStore((s) => s.enabledIds);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // 延迟注册，避免打开 popover 的 click 立即触发关闭
    const timer = setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handler);
    };
  }, [open, onClose]);

  if (!open) return null;

  const sources = getSources();
  const allEnabled = sources.every((s) => enabled.has(s.id));

  function handleToggle(id: ResultType) {
    const currentlyEnabled = enabled.has(id);
    // 如果全部启用中，切换单个 → 只保留这个
    if (allEnabled && currentlyEnabled) {
      for (const s of sources) {
        if (s.id !== id) toggleSource(s.id, false);
      }
    }
    toggleSource(id, !currentlyEnabled);
    onClose();
  }

  return (
    <div
      ref={popoverRef}
      className="workspace-floating"
      style={{
        position: 'absolute',
        top: '100%',
        right: 0,
        marginTop: 4,
        width: 200,
        padding: 4,
        zIndex: 200,
      }}
    >
      <div style={{
        padding: '6px 12px',
        fontSize: 'calc(11px * var(--ui-font-scale))',
        color: 'var(--text-muted)',
        fontWeight: 600,
      }}>
        搜索范围
      </div>
      {sources.map((s) => {
        const isEnabled = enabled.has(s.id);
        const count = counts[s.id];
        return (
          <button
            key={s.id}
            className="workspace-floating-row"
            onClick={() => handleToggle(s.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              textAlign: 'left',
              padding: '6px 12px',
              border: 'none',
              background: 'transparent',
              color: isEnabled ? 'var(--text-primary)' : 'var(--text-muted)',
              cursor: 'pointer',
              fontSize: 'calc(12px * var(--ui-font-scale))',
              fontFamily: 'var(--font-ui)',
            }}
            onMouseEnter={(e) => {
              (e.target as HTMLElement).style.background = 'var(--hover)';
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLElement).style.background = 'transparent';
            }}
          >
            <span style={{
              width: 16,
              height: 16,
              borderRadius: 3,
              border: `1.5px solid ${isEnabled ? 'var(--accent)' : 'var(--border)'}`,
              background: isEnabled ? 'var(--accent)' : 'transparent',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 'calc(10px * var(--ui-font-scale))',
              color: 'var(--accent-text)',
              flexShrink: 0,
            }}>
              {isEnabled ? <Check size={10} /> : ''}
            </span>
            <span style={{ flex: 1, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <s.icon size={12} /> {s.label}
            </span>
            {count !== undefined && count > 0 && (
              <span style={{
                fontSize: 'calc(10px * var(--ui-font-scale))',
                color: 'var(--text-muted)',
                background: 'var(--canvas)',
                padding: '0 6px',
                borderRadius: 8,
              }}>
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
