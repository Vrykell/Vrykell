import { forwardRef, type ForwardRefExoticComponent, type SVGProps } from 'react';
import PowerShellMark from '~icons/devicon/powershell';
import ZshMark from '~icons/devicon/zsh';
import BashMark from '~icons/devicon/bash';
import CmdMark from '~icons/devicon/windows8';
import SshMark from '~icons/mdi/ssh';
import { iconSizes, Terminal, type AppIcon, type AppIconProps } from '@ui/icons';

/**
 * Shell marks — brand icons compiled in at build time
 * (`~icons/<collection>/<name>` via unplugin-icons), sized like the app icons.
 *
 * PowerShell, zsh, bash and CMD use their colored devicon mark. SSH has no
 * colored logo, so it uses the monochrome `mdi:ssh` glyph rendered in the
 * theme's success color, which stays readable on both light and dark themes.
 * Shells without a mark fall back to the generic terminal icon.
 */

type BrandMark = ForwardRefExoticComponent<SVGProps<SVGSVGElement> & { title?: string }>;

/** Adapter that gives a build-time brand mark the app icon contract. */
function createShellIcon(Mark: BrandMark, mark: string, color?: string): AppIcon {
  return forwardRef<SVGSVGElement, AppIconProps>(function ShellIcon({ size = iconSizes.row, style, className }, ref) {
    return (
      <Mark
        ref={ref}
        width={size}
        height={size}
        className={className}
        data-shell-mark={mark}
        style={{ flexShrink: 0, ...style, ...(color ? { color } : null) }}
      />
    );
  }) as AppIcon;
}

export const PowerShellIcon = createShellIcon(PowerShellMark, 'powershell');
export const ZshIcon = createShellIcon(ZshMark, 'zsh');
export const BashIcon = createShellIcon(BashMark, 'bash');
export const CmdIcon = createShellIcon(CmdMark, 'cmd');

/** SSH connections have no colored brand mark; the monochrome glyph carries the theme color. */
export const SshIcon = createShellIcon(SshMark, 'ssh', 'var(--success)');

/** Icon for a local shell; unmapped shells use the generic terminal icon. */
export function shellIconFor(shellType: string | null | undefined): AppIcon {
  switch (shellType) {
    case 'powershell':
    case 'pwsh':
      return PowerShellIcon;
    case 'zsh':
      return ZshIcon;
    case 'bash':
      return BashIcon;
    case 'cmd':
      return CmdIcon;
    default:
      return Terminal;
  }
}
