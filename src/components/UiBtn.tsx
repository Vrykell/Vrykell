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
        color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
        background: active ? 'var(--accent-bg-strong)' : 'transparent',
      }}
      onMouseEnter={(e) => {
        const t = e.currentTarget as HTMLElement;
        if (!active) t.style.background = 'var(--hover)';
      }}
      onMouseLeave={(e) => {
        const t = e.currentTarget as HTMLElement;
        if (!active) t.style.background = 'transparent';
      }}
      {...(attrs ?? {})}
    >{children}</button>
  );
}

// ── 时长格式化 ──

export function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}m${s}s`;
}
