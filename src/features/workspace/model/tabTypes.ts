import { t } from '@i18n';
import { preferredShell, type DefaultShell } from '@config/terminalDefaults';
import { safeLocalStorageGet, safeLocalStorageSet } from '@utils/errorHandler';
import type { ShellOption, ShellType } from '@platform/shells';
import type { SshConnection } from '@features/ssh/services/api';

/**
 * Candidate types for the new-tab dialog and their "recently opened" ordering.
 *
 * Candidates are the locally available shells plus the configured SSH connections.
 * Sort keys live in localStorage so the most recently opened type comes first.
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

/** Record when a candidate type was last opened. */
export function touchRecentOpen(key: string, at = Date.now()): void {
  const map = loadRecentOpen();
  map[key] = at;
  saveRecentOpen(map);
}

/** Build candidates from the shell and SSH connection lists, sorted by most recent opening (never opened last, stable original order). */
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

  // Stable sort: most recent first; entries with the same timestamp (never opened) keep
  // their insertion order.
  return opts
    .map((o, i) => ({ o, i }))
    .sort((a, b) => (b.o.lastOpenedAt - a.o.lastOpenedAt) || (a.i - b.i))
    .map(({ o }) => o);
}
