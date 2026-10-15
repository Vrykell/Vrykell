import { describe, expect, it } from 'vitest';
import { historyDirectory } from '../historyDirectory';

describe('history directory identity', () => {
  it('normalizes local Windows separators and case while preserving drive roots', () => {
    expect(historyDirectory({ kind: 'local', cwd: 'C:\\Project\\' }, 'Unknown').id).toBe(historyDirectory({ kind: 'local', cwd: 'c:/project' }, 'Unknown').id);
    expect(historyDirectory({ kind: 'local', cwd: 'C:\\' }, 'Unknown').title).toBe('C:/');
    expect(historyDirectory({ kind: 'local', cwd: '/' }, 'Unknown').title).toBe('/');
  });
  it('keeps remote paths case-sensitive and scopes missing paths to their authority', () => {
    const target = { kind: 'ssh' as const, ssh: { host: 'SERVER.test', user: 'Dev', port: 2222 } };
    expect(historyDirectory({ ...target, cwd: '/Work' }, 'Unknown').id).not.toBe(historyDirectory({ ...target, cwd: '/work' }, 'Unknown').id);
    expect(historyDirectory(target, 'Unknown').title).toBe('Dev@server.test:2222 · Unknown');
    expect(historyDirectory(target, 'Unknown').id).not.toBe(historyDirectory({ ...target, ssh: { host: 'other.test' } }, 'Unknown').id);
  });
  it('does not merge legacy remote environments with unidentified targets', () => {
    expect(historyDirectory({ kind: 'ssh', cwd: '/srv', remoteId: 'one' }, 'Unknown').id)
      .not.toBe(historyDirectory({ kind: 'ssh', cwd: '/srv', remoteId: 'two' }, 'Unknown').id);
  });
});
