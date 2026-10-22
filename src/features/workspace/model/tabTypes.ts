import { t } from '@i18n';
import { preferredShell, type DefaultShell } from '@config/terminalDefaults';
import { safeLocalStorageGet, safeLocalStorageSet } from '@utils/errorHandler';
import type { ShellOption, ShellType } from '@platform/shells';
import type { SshConnection } from '@features/ssh/services/api';

/**
 * 新建标签页弹窗的候选类型与「最近打开」排序。
 *
 * 候选 = 机器可用的本地 shell + 已配置的 SSH 连接。
 * 排序键持久化在 localStorage，最近打开的类型排最前。
 */

export type NewTabOption =
  | {
      key: string;
      kind: 'shell';
      label: string;
      subtitle?: string;
      shellType: ShellType;
      lastOpenedAt: number;
    }
  | {
      key: string;
      kind: 'ssh';
      label: string;
      subtitle?: string;
      sshId: string;
      lastOpenedAt: number;
    };

const RECENT_KEY = 'vrykell-tab-type-recent';

export function loadRecentOpen(): Record<string, number> {
  try {
    const raw = safeLocalStorageGet(RECENT_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'number') out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function saveRecentOpen(map: Record<string, number>): void {
  safeLocalStorageSet(RECENT_KEY, JSON.stringify(map));
}

/** 记录某类型最近打开时间。 */
export function touchRecentOpen(key: string, at = Date.now()): void {
  const map = loadRecentOpen();
  map[key] = at;
  saveRecentOpen(map);
}

/** 用 shell 列表 + SSH 连接列表构建候选，按最近打开时间倒序（未打开过的排最后，按原始顺序稳定）。 */
export function buildNewTabOptions(
  shells: ShellOption[],
  sshs: SshConnection[],
  recent: Record<string, number> = loadRecentOpen(),
  defaultShell: DefaultShell = 'system',
): NewTabOption[] {
  const opts: NewTabOption[] = [];

  for (const s of shells) {
    opts.push({
      key: `shell:${s.id}`,
      kind: 'shell',
      label: s.label,
      subtitle: s.id === preferredShell(defaultShell, shells) ? t('Default terminal') : undefined,
      shellType: s.id,
      lastOpenedAt: recent[`shell:${s.id}`] ?? 0,
    });
  }
  for (const c of sshs) {
    opts.push({
      key: `ssh:${c.id}`,
      kind: 'ssh',
      label: c.name,
      subtitle: c.host,
      sshId: c.id,
      lastOpenedAt: recent[`ssh:${c.id}`] ?? 0,
    });
  }

  // 稳定排序：先按 lastOpenedAt 倒序；同为 0（从未打开）时保持插入顺序
  return opts
    .map((o, i) => ({ o, i }))
    .sort((a, b) => (b.o.lastOpenedAt - a.o.lastOpenedAt) || (a.i - b.i))
    .map(({ o }) => o);
}
