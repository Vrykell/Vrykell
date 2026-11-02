import type { SshConnection } from '../services/api';
import { t } from '@i18n';

/** Saved profiles form a bounded route, ordered from the first hop to the destination. */
export function savedJumpRoute(connections: SshConnection[], jumpId?: string, ownerId?: string): SshConnection[] {
  const seen = new Set(ownerId ? [ownerId] : []);
  const route: SshConnection[] = [];
  let id = jumpId;
  while (id) {
    if (seen.has(id)) throw new Error(t('Jump connections cannot form a cycle.'));
    if (route.length >= 8) throw new Error(t('Up to 8 jump hosts are supported.'));
    seen.add(id);
    const connection = connections.find(connection => connection.id === id);
    if (!connection) throw new Error(t('Saved jump connection is unavailable.'));
    route.unshift(connection);
    id = connection.jumpConnectionId;
  }
  return route;
}
