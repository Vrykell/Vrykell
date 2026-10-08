import { forwardRef } from 'react';
import { iconSizes, Terminal, type AppIcon, type AppIconProps } from '@ui/icons';

/** Small terminal windows share one silhouette and distinguish sessions by color. */
function createShellTile(mark: string, color: string): AppIcon {
  return forwardRef<SVGSVGElement, AppIconProps>(function ShellTile({ size = iconSizes.row, style, className }, ref) {
    return <svg ref={ref} width={size} height={size} viewBox="0 0 24 24" className={className}
      data-shell-mark={mark} aria-hidden="true" style={{ flexShrink: 0, ...style, color }}>
      <rect x="1" y="3" width="22" height="18" rx="3.5" fill="currentColor" />
      <path d="m6 8 4 4-4 4M12 16h6" fill="none" stroke="var(--shell-tile-ink)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>;
  }) as AppIcon;
}

export const PowerShellIcon = createShellTile('powershell', 'var(--shell-powershell-accent)');
export const ZshIcon = createShellTile('zsh', 'var(--shell-zsh-accent)');
export const BashIcon = createShellTile('bash', 'var(--shell-bash-accent)');
export const CmdIcon = createShellTile('cmd', 'var(--shell-cmd-accent)');
export const SshIcon = createShellTile('ssh', 'var(--shell-ssh-accent)');

export function shellIconFor(shellType: string | null | undefined): AppIcon {
  switch (shellType) {
    case 'powershell':
    case 'pwsh': return PowerShellIcon;
    case 'zsh': return ZshIcon;
    case 'bash': return BashIcon;
    case 'cmd': return CmdIcon;
    default: return Terminal;
  }
}
