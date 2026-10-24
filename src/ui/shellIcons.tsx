import { forwardRef, type ComponentType, type SVGProps } from 'react';
import { iconSizes, type AppIcon, type AppIconProps } from '@ui/icons';
import BashMark from '~icons/devicon-plain/bash';
import PowerShellMark from '~icons/devicon/powershell';
import ClassicPowerShellMark from '~icons/vscode-icons/file-type-powershell';
import WindowsMark from '~icons/devicon/windows8';
import LinuxMark from '~icons/devicon/linux';
import AppleMark from '~icons/mdi/apple';
import UbuntuMark from '~icons/devicon/ubuntu';
import DebianMark from '~icons/devicon/debian';
import FedoraMark from '~icons/devicon/fedora';
import CentosMark from '~icons/devicon/centos';
import ArchMark from '~icons/devicon/archlinux';
import PythonMark from '~icons/devicon/python';
import NodeMark from '~icons/devicon/nodejs';
import GitMark from '~icons/devicon/git';
import FishMark from '~icons/devicon/fish';
import { useHostSystems } from '@config/hostSystems';

function profileIcon(mark: string, Mark: ComponentType<SVGProps<SVGSVGElement>>, color = 'var(--text-primary)', viewBox?: string): AppIcon {
  return forwardRef<SVGSVGElement, AppIconProps>(function ProfileIcon({ size = iconSizes.row, style, className }, ref) {
    return <Mark ref={ref} width={size} height={size} className={className}
      {...(viewBox ? { viewBox } : {})}
      data-shell-mark={mark} aria-hidden="true" style={{ flexShrink: 0, color, ...style }} />;
  }) as AppIcon;
}

export const TerminalIcon = profileIcon('terminal', PowerShellMark);
export const PowerShellIcon = profileIcon('powershell', ClassicPowerShellMark, 'var(--chart-blue)', '2 2 28 28');
export const ZshIcon = forwardRef<SVGSVGElement, AppIconProps>(function ZshIcon({ size = iconSizes.row, style, className }, ref) {
  return <svg ref={ref} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" data-shell-mark="zsh" className={className}
    style={{ color: 'var(--shell-zsh-accent)', flexShrink: 0, ...style }}>
    <rect x="1" y="2" width="22" height="20" rx="4" fill="currentColor" />
    <path d="M7 7h10L7 17h10" fill="none" stroke="var(--primary-button-text)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
});
export const BashIcon = profileIcon('bash', BashMark, 'var(--group-green)');
export const CmdIcon = profileIcon('cmd', WindowsMark);
export const SshIcon = profileIcon('linux', LinuxMark);
const AppleIcon = profileIcon('macos', AppleMark);
const UbuntuIcon = profileIcon('ubuntu', UbuntuMark);
const DebianIcon = profileIcon('debian', DebianMark);
const FedoraIcon = profileIcon('fedora', FedoraMark);
const CentosIcon = profileIcon('centos', CentosMark);
const ArchIcon = profileIcon('arch', ArchMark);
const PythonIcon = profileIcon('python', PythonMark);
const NodeIcon = profileIcon('node', NodeMark);
const GitIcon = profileIcon('git-bash', GitMark);
const FishIcon = profileIcon('fish', FishMark);

export function shellIconFor(shellType: string | null | undefined): AppIcon {
  switch (shellType?.toLowerCase()) {
    case 'powershell': case 'pwsh': return PowerShellIcon;
    case 'zsh': return ZshIcon;
    case 'bash': return BashIcon;
    case 'cmd': return CmdIcon;
    case 'fish': return FishIcon;
    case 'git-bash': return GitIcon;
    case 'python': return PythonIcon;
    case 'node': case 'nodejs': return NodeIcon;
    default: return TerminalIcon;
  }
}

export function hostIconFor(system: string | undefined): AppIcon {
  const name = typeof system === 'string' ? system.toLowerCase() : '';
  if (name.includes('ubuntu')) return UbuntuIcon;
  if (name.includes('debian')) return DebianIcon;
  if (name.includes('fedora')) return FedoraIcon;
  if (name.includes('centos')) return CentosIcon;
  if (/\barch(?:linux)?\b/.test(name)) return ArchIcon;
  if (name.includes('darwin') || name.includes('macos')) return AppleIcon;
  if (name.includes('windows')) return CmdIcon;
  return SshIcon;
}

export function TerminalProfileIcon({ kind, shellType, connectionId, size = iconSizes.row, colored = true }: {
  kind?: string; shellType?: string; connectionId?: string; size?: number; colored?: boolean;
}) {
  const system = useHostSystems(state => connectionId ? state.systems[connectionId] : undefined);
  const Icon = kind === 'ssh' ? hostIconFor(system) : shellIconFor(shellType);
  return <span className="identity-icon" data-colored={colored}><Icon size={size} /></span>;
}
