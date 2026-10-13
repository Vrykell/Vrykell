/**
 * ShellIndicator — 的 Shell 类型胶囊徽章。
 *
 * 显示为圆角 pill：连接状态点 + shell 名称，带淡淡的背景色。
 */

export interface ShellInfo {
  type: 'zsh' | 'bash' | 'fish' | 'powershell' | 'wsl' | 'docker' | 'unknown';
  label: string;
}

/** 根据 shell 路径推断类型 */
export function detectShell(shellPath?: string): ShellInfo {
  const path = (shellPath ?? '').toLowerCase();
  if (path.includes('zsh')) return { type: 'zsh', label: 'zsh' };
  if (path.includes('bash')) return { type: 'bash', label: 'bash' };
  if (path.includes('fish')) return { type: 'fish', label: 'fish' };
  if (path.includes('powershell') || path.includes('pwsh')) return { type: 'powershell', label: 'ps' };
  if (path.includes('wsl')) return { type: 'wsl', label: 'wsl' };
  return { type: 'unknown', label: 'sh' };
}

/** Shell 类型 → 徽章背景色（：淡色胶囊） */
const SHELL_BG: Record<ShellInfo['type'], string> = {
  zsh: 'var(--hover)',
  bash: 'var(--hover)',
  fish: 'var(--hover)',
  powershell: 'var(--hover)',
  wsl: 'var(--accent-warm-dim)',
  docker: 'var(--hover)',
  unknown: 'var(--hover)',
};

const SHELL_FG: Record<ShellInfo['type'], string> = {
  zsh: 'var(--accent-blue)',
  bash: 'var(--accent-blue)',
  fish: 'var(--accent-blue)',
  powershell: 'var(--accent-blue)',
  wsl: 'var(--accent-warm)',
  docker: 'var(--accent-blue)',
  unknown: 'var(--text-secondary)',
};

interface Props {
  shell?: ShellInfo;
  /** 是否显示连接状态点 */
  connected?: boolean;
  /** 该终端是否为当前聚焦终端（聚焦态点亮绿灯） */
  focused?: boolean;
  /** 仅显示点 + 名称（无胶囊背景，用于紧凑布局） */
  compact?: boolean;
  /** 覆盖显示名（终端类型 / SSH 连接名） */
  label?: string;
}

export default function ShellIndicator({ shell, connected, focused, compact, label }: Props) {
  const info = shell ?? { type: 'unknown' as const, label: 'sh' };
  const fg = SHELL_FG[info.type];
  const bg = SHELL_BG[info.type];
  // 状态点：未连接=红；已连接且聚焦=绿；已连接未聚焦=灰
  const dotColor = connected === false
    ? 'var(--shell-disconnected)'
    : focused
      ? 'var(--shell-connected)'
      : 'var(--text-muted)';

  return (
    <span
      className={compact ? undefined : 'terminal-chip'}
      data-tip={label ?? info.label}
      style={compact
        ? {
            display: 'inline-flex',
            flexShrink: 0,
            whiteSpace: 'nowrap',
            alignItems: 'center',
            gap: 5,
            fontFamily: 'var(--font-mono)',
            fontSize: 'calc(11px * var(--ui-font-scale))',
            fontWeight: 'var(--fw-medium)',
            color: fg,
            userSelect: 'none',
          }
        : { color: fg, background: bg, fontWeight: 'var(--fw-medium)', userSelect: 'none' }}
    >
      {connected !== undefined && (
        <span
          style={{
            display: 'inline-block',
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: dotColor,
            flexShrink: 0,
            transition: 'background 0.12s ease',
          }}
        />
      )}
      <span>{label ?? info.label}</span>
    </span>
  );
}
