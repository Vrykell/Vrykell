import { Check } from 'lucide-react';
import type { ReactNode } from 'react';

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
}

interface SegmentedProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** 'sm' 用于紧凑行（如权限表），'md' 用于普通字段 */
  size?: 'sm' | 'md';
}

/**
 * Segmented — 圆角分段选择器。
 *
 * 整条是一个圆角矩形；首/末按钮各带外侧圆角，使被选中项的高亮填满圆角区域
 * （不再出现「选中块是直角、容器是圆角」导致的角落留缝）。
 */
export default function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
}: SegmentedProps<T>) {
  // 容器有 1px 边框，按钮外侧圆角需减 1px 才能与内容盒圆角严丝合缝
  const innerRadius = 'calc(var(--radius-inner) - 1px)';
  const pad = size === 'sm' ? '3px 10px' : '5px 14px';
  const fontSize = 'calc(12px * var(--ui-font-scale))';

  return (
    <div
      style={{
        display: 'inline-flex',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-inner)',
        background: 'transparent',
      }}
    >
      {options.map((o, i) => {
        const active = o.value === value;
        const first = i === 0;
        const last = i === options.length - 1;
        return (
          <button
            key={o.value}
            data-subtle
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            style={{
              fontSize,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5,
              padding: pad,
              border: 'none',
              cursor: 'pointer',
              background: active ? 'var(--accent)' : 'transparent',
              color: active ? 'var(--accent-text)' : 'var(--text-secondary)',
              borderTopLeftRadius: first ? innerRadius : 0,
              borderBottomLeftRadius: first ? innerRadius : 0,
              borderTopRightRadius: last ? innerRadius : 0,
              borderBottomRightRadius: last ? innerRadius : 0,
            }}
          >
            {active && <Check size={11} aria-hidden="true" />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
