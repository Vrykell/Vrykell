/**
 * 共享 UI 原子组件 — 避免在多个文件间复制粘贴。
 * 样式已迁移至 UiBtn.module.css（CSS Modules），消除 JS 手动 hover 反模式。
 */

import type { MouseEvent } from 'react';
import { cx } from '@/shared/utils/cx';
import s from './UiBtn.module.css';

// ── 通用小型按钮（header hover 工具条用）──

interface HBtnProps {
  title: string;
  onClick: (e: MouseEvent) => void;
  children: string;
}

export function HBtn({ title, onClick, children }: HBtnProps) {
  return (
    <button title={title} onClick={onClick} className={s.hBtn}>
      {children}
    </button>
  );
}

// ── 输入栏小按钮（InputEditor 用，样式略有不同）──

export function InputBtn({ title, onClick, children }: HBtnProps) {
  return (
    <button title={title} onClick={onClick} className={s.inputBtn}>
      {children}
    </button>
  );
}

// ── 下拉/右键菜单项 ──

interface MenuItemProps {
  label: string;
  onClick: () => void;
  danger?: boolean;
}

export function MenuItem({ label, onClick, danger }: MenuItemProps) {
  return (
    <button onClick={onClick} className={cx(s.menuItem, danger && s.menuItemDanger)}>
      {label}
    </button>
  );
}

// ── 侧栏图标按钮（24×24，悬停显背景；标签/SSH/文件面板统一使用）──

interface IconBtnProps {
  title: string;
  onClick?: (e: MouseEvent) => void;
  disabled?: boolean;
  children: React.ReactNode;
  [key: string]: unknown;
}

export function IconBtn({ title, onClick, disabled, children, ...rest }: IconBtnProps) {
  const props: Record<string, unknown> = {
    'data-subtle': true,
    title,
    onClick,
    disabled,
    className: s.iconBtn,
    ...rest,
  };
  return <button {...props}>{children}</button>;
}

// ── 顶栏工具栏按钮（28×28 正方形图标按钮）──

interface ToolbarBtnProps {
  title: string;
  active?: boolean;
  onClick?: (e: MouseEvent) => void;
  children: React.ReactNode;
  /** 附加的 HTML 属性（如 data-*, draggable, onDragStart 等） */
  attrs?: Record<string, unknown>;
}

export function ToolbarBtn({ title, active, onClick, children, attrs }: ToolbarBtnProps) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={cx(s.toolbarBtn, active && s.toolbarBtnActive)}
      {...(attrs ?? {})}
    >
      {children}
    </button>
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
