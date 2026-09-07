import type { ReactNode } from 'react';
import { cx } from '@/styles/cx';
import s from './Segmented.module.css';

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
 * 整条是一个圆角矩形；首/末按钮各带外侧圆角，使被选中项的高亮填满圆角区域。
 */
export default function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
}: SegmentedProps<T>) {
  const innerRadius = 'calc(var(--radius-inner) - 1px)';
  const pad = size === 'sm' ? '3px 10px' : '5px 14px';

  return (
    <div className={s.container}>
      {options.map((o, i) => {
        const active = o.value === value;
        const first = i === 0;
        const last = i === options.length - 1;
        return (
          <button
            key={o.value}
            data-subtle
            type="button"
            onClick={() => onChange(o.value)}
            className={cx(s.btn, active ? s.btnActive : s.btnInactive)}
            style={{
              padding: pad,
              borderTopLeftRadius: first ? innerRadius : 0,
              borderBottomLeftRadius: first ? innerRadius : 0,
              borderTopRightRadius: last ? innerRadius : 0,
              borderBottomRightRadius: last ? innerRadius : 0,
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
