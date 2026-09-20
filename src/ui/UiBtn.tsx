/**
 * 共享 UI 原子组件 — 避免在多个文件间复制粘贴。
 */

import type { CSSProperties, MouseEvent } from 'react';

// ── 通用小型按钮（header hover 工具条用）──

interface HBtnProps {
  title: string;
  onClick: (e: MouseEvent) => void;
  children: string;
}

export function HBtn({ title, onClick, children }: HBtnProps) {
  return (
    <button title={title} onClick={onClick} style={hBtnStyle}
      onMouseEnter={(e) => { (e.target as HTMLElement).style.background = 'var(--hover)'; }}
      onMouseLeave={(e) => { (e.target as HTMLElement).style.background = 'transparent'; }}
    >{children}</button>
  );
}

const hBtnStyle: CSSProperties = {
  fontSize: 11, padding: '1px 5px', border: 'none', borderRadius: 3,
  background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer',
  lineHeight: '18px',
};

// ── 输入栏小按钮（InputEditor 用，样式略有不同）──

export function InputBtn({ title, onClick, children }: HBtnProps) {
  return (
    <button title={title} onClick={onClick} style={inputBtnStyle}
      onMouseEnter={(e) => {
        (e.target as HTMLElement).style.background = 'var(--hover)';
        (e.target as HTMLElement).style.borderColor = 'var(--border)';
      }}
      onMouseLeave={(e) => {
        (e.target as HTMLElement).style.background = 'transparent';
        (e.target as HTMLElement).style.borderColor = 'transparent';
      }}
    >{children}</button>
  );
}

const inputBtnStyle: CSSProperties = {
  fontSize: 12, padding: '1px 5px',
  background: 'transparent', border: '1px solid transparent',
  borderRadius: 3, color: 'var(--text-secondary)', cursor: 'pointer',
  lineHeight: '22px',
};

// ── 下拉/右键菜单项 ──

interface MenuItemProps {
  label: string;
  onClick: () => void;
  danger?: boolean;
}

export function MenuItem({ label, onClick, danger }: MenuItemProps) {
  return (
    <button
      onClick={onClick}
      style={danger ? { ...menuItemStyle, color: 'var(--error)' } : menuItemStyle}
      onMouseEnter={(e) => { (e.target as HTMLElement).style.background = 'var(--hover)'; }}
      onMouseLeave={(e) => { (e.target as HTMLElement).style.background = 'transparent'; }}
    >{label}</button>
  );
}

const menuItemStyle: CSSProperties = {
  display: 'block', width: '100%', textAlign: 'left' as const,
  padding: '6px 12px', border: 'none', background: 'transparent',
  color: 'var(--text-primary)', cursor: 'pointer', fontSize: 12,
};

// ── 侧栏图标按钮（24×24，悬停显背景；标签/SSH/文件面板统一使用）──

interface IconBtnProps {
  title: string;
  onClick?: (e: MouseEvent) => void;
  disabled?: boolean;
  children: React.ReactNode;
  [key: string]: unknown;
}

export function IconBtn({ title, onClick, disabled, children, ...rest }: IconBtnProps) {
  return (
    <button
      data-subtle
      title={title}
      onClick={onClick}
      disabled={disabled}
      {...rest}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 24, height: 24, padding: 0, borderRadius: 5,
        background: 'transparent', border: 'none', color: 'var(--text-muted)',
        cursor: disabled ? 'default' : 'pointer', flexShrink: 0, opacity: disabled ? 0.4 : 1,
      }}
      onMouseEnter={(e) => {
        if (!disabled) {
          e.currentTarget.style.background = 'var(--button-hover)';
          e.currentTarget.style.color = 'var(--text-secondary)';
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.color = 'var(--text-muted)';
      }}
    >
      {children}
    </button>
  );
}

// ── 顶栏工具栏按钮（24×24 正方形图标按钮）──

interface ToolbarBtnProps {
  title: string;
  active?: boolean;
  onClick?: (e: MouseEvent) => void;
  children: React.ReactNode;
  /** 附加的 HTML 属性（如 data-*, draggable, onDragStart 等） */
  attrs?: Record<string, unknown>;
}

const toolbarBtnBase: CSSProperties = {
  width: 28, height: 28,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontSize: 15, lineHeight: 1,
  border: 'none', borderRadius: 6,
  background: 'transparent', color: 'var(--text-secondary)',
  cursor: 'pointer', userSelect: 'none', flexShrink: 0,
  padding: 0,
  transition: 'background 0.12s ease, color 0.12s ease',
  // @ts-expect-error Tauri 拖拽区域排除
  WebkitAppRegion: 'no-drag',
};

export function ToolbarBtn({ title, active, onClick, children, attrs }: ToolbarBtnProps) {
  return (
    <button
      title={title}
      onClick={onClick}
      style={{
        ...toolbarBtnBase,
        // 状态用图标颜色表达，不使用背景：默认灰、悬停亮、打开=琥珀金
        color: active ? 'var(--accent)' : 'var(--text-secondary)',
      }}
      onMouseEnter={(e) => {
        const t = e.currentTarget as HTMLElement;
        t.style.color = active ? 'var(--accent)' : 'var(--text-primary)';
      }}
      onMouseLeave={(e) => {
        const t = e.currentTarget as HTMLElement;
        t.style.color = active ? 'var(--accent)' : 'var(--text-secondary)';
      }}
      {...(attrs ?? {})}
    >{children}</button>
  );
}

// ── 时长/大小格式化 ──

export function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}m${s}s`;
}

/** 字节数格式化（B/KB/MB/GB/TB）。 */
export function fmtSize(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}
