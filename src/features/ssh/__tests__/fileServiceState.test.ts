import { describe, expect, it } from 'vitest';
import { describeFileServiceFailure } from '../model/fileServiceState';

describe('file service status', () => {
  it('distinguishes absent SFTP from an incompatible file transport', () => {
    expect(describeFileServiceFailure('SFTP_UNAVAILABLE:subsystem request failed')).toMatchObject({ kind: 'unavailable', title: '此连接暂不能浏览文件' });
    const handshake = describeFileServiceFailure('SSH 握手失败：[Session(-5)] Unable to exchange encryption keys');
    expect(handshake.kind).toBe('unavailable');
    expect(handshake.message).toContain('文件客户端');
    expect(handshake.message).not.toContain('不支持 SFTP');
  });
  it('keeps network, permission and changed-key errors actionable', () => {
    expect(describeFileServiceFailure('连接失败：timeout').kind).toBe('error');
    expect(describeFileServiceFailure('读取目录失败：Permission denied').kind).toBe('error');
    expect(describeFileServiceFailure('主机密钥不匹配').kind).toBe('error');
    expect(describeFileServiceFailure('密码认证失败').kind).toBe('authentication');
  });
});
