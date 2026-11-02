import { describe, expect, it } from 'vitest';
import { parseSshConnectionFailure, sshConnectionFailureMessage } from '../model/connectionFailure';
import { describeFileServiceFailure, isSshAuthenticationFailure } from '../model/fileServiceState';

describe('connection failure context', () => {
  const failure = { connectionId: 'gateway', host: 'gateway.test', port: 2222, stage: 'authentication', cause: 'SSH_AUTH_FAILED: rejected' };
  const detail = `SSH_JUMP_FAILED:gateway: SSH_CONNECTION_FAILED:${JSON.stringify(failure)}`;
  it('keeps the failing hop and authentication action through outer service context', () => {
    expect(parseSshConnectionFailure(detail)).toEqual(failure);
    expect(sshConnectionFailureMessage(detail)).toBe('连接 gateway.test:2222 时，认证阶段失败。');
    expect(isSshAuthenticationFailure(detail)).toBe(true);
    expect(describeFileServiceFailure(detail)).toMatchObject({ kind: 'authentication', message: expect.stringContaining('gateway.test:2222') });
  });
  it('retains SFTP capability errors and safely ignores malformed metadata', () => {
    expect(describeFileServiceFailure(`SSH_CONNECTION_FAILED:${JSON.stringify({ ...failure, stage: 'sftp-open', cause: 'SFTP_UNAVAILABLE: rejected' })}`).kind).toBe('unavailable');
    for (const value of ['plain failure', 'SSH_CONNECTION_FAILED:null', 'SSH_CONNECTION_FAILED:{', 'SSH_CONNECTION_FAILED:{"host":"test"}', `SSH_CONNECTION_FAILED:${JSON.stringify({ ...failure, port: -1 })}`]) {
      expect(parseSshConnectionFailure(value)).toBeNull();
      expect(sshConnectionFailureMessage(value)).toBeNull();
    }
  });
});
