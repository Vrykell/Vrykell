import { invoke } from '@platform/diagnostics';
import type { SshForwardingRule } from '@core/ssh';
import type { SshConnection } from './api';
import { formatForwardRules, parseForwardTexts } from '../model/forwardRules';
import { prepareSshHost } from './hostTrust';
import { isSshAuthenticationFailure } from '../model/fileServiceState';
import { requestSshAuthentication } from '../stores/sessionAuthentication';

export interface ForwardingStatus { id: string; running: boolean; error: string | null }
export const listForwardingStatus = () => invoke<ForwardingStatus[]>('ssh_forwards_status');
export async function startForwarding(connectionId: string, ruleId: string): Promise<void> {
  const { useSshStore } = await import('../stores/store');
  const connection = useSshStore.getState().connections.find(connection => connection.id === connectionId);
  if (!connection) throw new Error('Forwarding host no longer exists');
  await prepareSshHost(connection.host, connection.port, undefined, connection);
  try { await invoke<void>('ssh_forward_start', { connectionId, ruleId }); }
  catch (reason) {
    if (isSshAuthenticationFailure(String(reason))) requestSshAuthentication({ connectionId, host: connection.host, port: connection.port, user: connection.user, identityFile: connection.identityFile });
    throw reason;
  }
}
export const stopForwarding = (connectionId: string, ruleId: string) => invoke<void>('ssh_forward_stop', { connectionId, ruleId });

export function connectionRules(connection: SshConnection): SshForwardingRule[] {
  return connection.forwardingRules ?? (parseForwardTexts({ local: (connection.localForwards ?? []).join('\n'), remote: (connection.remoteForwards ?? []).join('\n'), dynamic: (connection.dynamicForwards ?? []).join('\n') }) ?? []).map(rule => ({ ...rule, name: '', bind: rule.bind || '127.0.0.1', port: Number(rule.port), targetPort: Number(rule.targetPort) || 0, autoStart: true }));
}

export function withForwardingRules(connection: SshConnection, rules: SshForwardingRule[]): SshConnection {
  return { ...connection, forwardingRules: rules, localForwards: [], remoteForwards: [], dynamicForwards: [] };
}

export function forwardingSpecification(rule: SshForwardingRule): string {
  const text = formatForwardRules([{ ...rule, port: String(rule.port), targetPort: String(rule.targetPort) }]);
  return text[rule.kind];
}

export async function startAutomaticForwarding(connectionId: string): Promise<void> {
  const { useSshStore } = await import('../stores/store');
  const connection = useSshStore.getState().connections.find(connection => connection.id === connectionId);
  if (!connection?.forwardingRules) return;
  const results = await Promise.allSettled(connection.forwardingRules.filter(rule => rule.autoStart).map(rule => startForwarding(connectionId, rule.id)));
  const errors = results.flatMap(result => result.status === 'rejected' ? [String(result.reason)] : []);
  if (errors.length) throw new Error(errors.join('\n'));
}
