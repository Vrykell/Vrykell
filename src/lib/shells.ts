import { invoke } from '@tauri-apps/api/core';
import { isMacOS } from './platform';

/** 本地 shell 类型标识 */
export type ShellType = 'zsh' | 'bash' | 'powershell' | 'pwsh' | 'cmd';

/** shell 类型 → 显示名（默认标签标题用）。 */
export function shellTypeLabel(t: ShellType): string {
  switch (t) {
    case 'zsh': return 'Zsh';
    case 'bash': return 'Bash';
    case 'powershell': return 'PowerShell';
    case 'pwsh': return 'PowerShell';
    case 'cmd': return 'CMD';
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
    if (shells && shells.length > 0) return shells;
    return fallbackShells();
  } catch {
    return fallbackShells();
  }
}
