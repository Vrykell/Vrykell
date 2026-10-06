import { forwardRef } from 'react';
import PowerShellMark from '~icons/devicon/powershell';
import ZshMark from '~icons/devicon-plain/zsh';
import { iconSizes, Terminal, type AppIcon, type AppIconProps } from '@ui/icons';

/**
 * Shell marks — official brand icons compiled in at build time
 * (`~icons/<collection>/<name>` via unplugin-icons), sized like the app icons.
 *
 * PowerShell keeps its classic blue mark from the devicon set; zsh uses the
 * monochrome devicon-plain mark so it can follow the row color on any theme.
 * Shells without a mark (bash, cmd, unknown/default shell) fall back to the
 * generic terminal icon.
 */

export const PowerShellIcon = forwardRef<SVGSVGElement, AppIconProps>(function PowerShellIcon(
  { size = iconSizes.row, style, className },
) {
  return (
    <PowerShellMark
      width={size}
      height={size}
      className={className}
      data-shell-mark="powershell"
      style={{ flexShrink: 0, ...style }}
    />
  );
}) as AppIcon;

export const ZshIcon = forwardRef<SVGSVGElement, AppIconProps>(function ZshIcon(
  { size = iconSizes.row, style, className },
) {
  return (
    <ZshMark
      width={size}
      height={size}
      className={className}
      data-shell-mark="zsh"
      style={{ flexShrink: 0, ...style }}
    />
  );
}) as AppIcon;

/**
 * Icon for a local shell: PowerShell and zsh have their own mark, everything
 * else (bash, cmd, unknown/default shell) uses the generic terminal icon.
 */
export function shellIconFor(shellType: string | null | undefined): AppIcon {
  switch (shellType) {
    case 'powershell':
    case 'pwsh':
      return PowerShellIcon;
    case 'zsh':
      return ZshIcon;
    default:
      return Terminal;
  }
}
