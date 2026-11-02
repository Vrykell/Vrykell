import { describe, expect, it } from 'vitest';
import { savedJumpRoute } from '../model/jumpRoute';
import { validateSshConnection, connectionTarget, type SshConnection } from '../services/api';

const profile = (id: string, jumpConnectionId?: string): SshConnection => ({ id, name: id, host: `${id}.test`, user: `${id}-user`, authMethod: 'key', jumpConnectionId });

describe('saved jump routes', () => {
  it('orders independently authenticated hops and carries the reference into terminal requests', () => {
    const connections = [profile('first'), profile('second', 'first'), profile('target', 'second')];
    expect(savedJumpRoute(connections, 'second', 'target').map(connection => connection.user)).toEqual(['first-user', 'second-user']);
    expect(connectionTarget(connections[2]).jumpConnectionId).toBe('second');
    expect(savedJumpRoute(connections)).toEqual([]);
  });

  it('rejects cycles, missing profiles and excessive depth', () => {
    expect(() => savedJumpRoute([profile('one', 'two'), profile('two', 'one')], 'two', 'one')).toThrow('循环');
    expect(() => savedJumpRoute([], 'deleted')).toThrow('不可用');
    const chain = Array.from({ length: 9 }, (_, index) => profile(`hop-${index}`, index ? `hop-${index - 1}` : undefined));
    expect(savedJumpRoute(chain, 'hop-7')).toHaveLength(8);
    expect(() => savedJumpRoute(chain, 'hop-8')).toThrow('8');
  });

  it('validates route selection without allowing conflicting addresses or proxy destinations', () => {
    const target = profile('target', 'jump');
    expect(validateSshConnection(target)).toBeNull();
    expect(validateSshConnection({ ...target, jumpConnectionId: 'target' })).not.toBeNull();
    expect(validateSshConnection({ ...target, jumpHost: 'user@other' })).not.toBeNull();
    expect(validateSshConnection({ ...target, proxyId: 'office' })).not.toBeNull();
    expect(validateSshConnection({ ...target, proxyId: 'none' })).toBeNull();
    expect(validateSshConnection({ ...target, jumpConnectionId: undefined, jumpHost: Array(9).fill('user@jump').join(',') })).not.toBeNull();
  });
});
