import { invoke } from '@platform/diagnostics';
import { isMacOS } from '@platform/runtime';
import { t as translate } from '@i18n';

/** 本地 shell 类型标识 */
export type ShellType = 'zsh' | 'bash' | 'powershell' | 'pwsh' | 'cmd';

/** Every configurable shell type, in the order settings lists them. */
export const SHELL_TYPES: ShellType[] = ['zsh', 'bash', 'powershell', 'pwsh', 'cmd'];

/** Map a shell type to its display name, used for default tab titles. */
export function shellTypeLabel(shell: string): string {
  switch (shell) {
    case 'zsh': return 'Zsh';
    case 'bash': return 'Bash';
    // The OS-bundled Windows PowerShell and the standalone pwsh build are different
    // executables with their own open mode; identical labels would show two look-alike rows.
    case 'powershell': return 'Windows PowerShell';
    case 'pwsh': return 'PowerShell 7';
    case 'cmd': return 'CMD';
    default: return shell || translate('Terminal');
  }
}

export interface ShellOption {
  id: ShellType;
  label: string;
  default: boolean;
}

/** 调用 Rust list_shells 获取机器上可用的 shell。 */
export function listShells(): Promise<ShellOption[]> {
  return invoke<ShellOption[]>('list_shells');
}

/** 非 Tauri 环境（纯浏览器 dev / 测试）下的平台猜测兜底。 */
export function fallbackShells(): ShellOption[] {
  if (isMacOS) {
    return [
      { id: 'zsh', label: 'Zsh', default: true },
      { id: 'bash', label: 'Bash', default: false },
    ];
  }
  return [
    { id: 'powershell', label: 'PowerShell', default: true },
    { id: 'cmd', label: 'CMD', default: false },
  ];
}

/** 获取可用 shell；invoke 失败（无后端）时回退平台猜测，保证弹窗可用。 */
export async function getAvailableShells(): Promise<ShellOption[]> {
  try {
    const shells = await listShells();
    if (Array.isArray(shells) && shells.length > 0) return shells;
    return fallbackShells();
  } catch {
    return fallbackShells();
  }
}
