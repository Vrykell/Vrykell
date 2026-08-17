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
  zsh: 'rgba(255,255,255,0.08)',
  bash: 'rgba(255,255,255,0.08)',
  fish: 'rgba(255,255,255,0.08)',
  powershell: 'rgba(255,255,255,0.08)',
  wsl: 'rgba(217,119,87,0.18)',
  docker: 'rgba(255,255,255,0.08)',
  unknown: 'rgba(255,255,255,0.06)',
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
  /** 仅显示点 + 名称（无胶囊背景，用于紧凑布局） */
  compact?: boolean;
}

export default function ShellIndicator({ shell, connected, compact }: Props) {
  const info = shell ?? { type: 'unknown' as const, label: 'sh' };
  const fg = SHELL_FG[info.type];
  const bg = SHELL_BG[info.type];

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        fontWeight: 500,
        color: fg,
        userSelect: 'none',
        ...(compact
          ? {}
          : {
              background: bg,
              borderRadius: 5,
              padding: '1px 7px',
              lineHeight: '18px',
            }),
      }}
    >
      {connected !== undefined && (
        <span
          style={{
            display: 'inline-block',
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: connected ? 'var(--shell-connected)' : 'var(--shell-disconnected)',
            flexShrink: 0,
          }}
        />
      )}
      <span>{info.label}</span>
    </span>
  );
}
