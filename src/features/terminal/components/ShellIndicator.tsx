/**
 * ShellIndicator — shell type pill badge.
 *
 * Rounded pill with a connection status dot and the shell name on a faint background.
 */

export interface ShellInfo {
  type: 'zsh' | 'bash' | 'fish' | 'powershell' | 'wsl' | 'docker' | 'unknown';
  label: string;
}

/** Infer the shell type from its path */
export function detectShell(shellPath?: string): ShellInfo {
  const path = (shellPath ?? '').toLowerCase();
  if (path.includes('zsh')) return { type: 'zsh', label: 'zsh' };
  if (path.includes('bash')) return { type: 'bash', label: 'bash' };
  if (path.includes('fish')) return { type: 'fish', label: 'fish' };
  if (path.includes('powershell') || path.includes('pwsh')) return { type: 'powershell', label: 'ps' };
  if (path.includes('wsl')) return { type: 'wsl', label: 'wsl' };
  return { type: 'unknown', label: 'sh' };
}

/** Shell type → badge background color (faint pill) */
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
  /** Show the connection status dot */
  connected?: boolean;
  /** Whether this terminal is focused (a focused terminal lights the dot green) */
  focused?: boolean;
  /** Show only the dot and name, without a pill background, for compact layouts */
  compact?: boolean;
  /** Override label (terminal type or SSH connection name) */
  label?: string;
}

export default function ShellIndicator({ shell, connected, focused, compact, label }: Props) {
  const info = shell ?? { type: 'unknown' as const, label: 'sh' };
  const fg = SHELL_FG[info.type];
  const bg = SHELL_BG[info.type];
  // Status dot: disconnected = red; connected and focused = green; connected but unfocused = muted
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
      <span className="shell-indicator-label">{label ?? info.label}</span>
    </span>
  );
}
