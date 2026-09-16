import { describe, it, expect } from 'vitest';
import { sensitivePathReason } from '@features/agent/model/sensitivePaths';

describe('sensitivePathReason', () => {
  it('命中 SSH/AWS/GPG 密钥目录', () => {
    expect(sensitivePathReason('/Users/u/.ssh/id_ed25519')).toBeTruthy();
    expect(sensitivePathReason('~/.ssh/config')).toBeTruthy();
    expect(sensitivePathReason('/home/u/.aws/credentials')).toBeTruthy();
    expect(sensitivePathReason('~/.gnupg/secring.gpg')).toBeTruthy();
  });

  it('命中凭据文件与 .env', () => {
    expect(sensitivePathReason('/home/u/proj/.env')).toBeTruthy();
    expect(sensitivePathReason('/home/u/proj/.env.production')).toBeTruthy();
    expect(sensitivePathReason('~/.git-credentials')).toBeTruthy();
    expect(sensitivePathReason('/Users/u/.netrc')).toBeTruthy();
    expect(sensitivePathReason('~/.npmrc')).toBeTruthy();
  });

  it('命中应用配置与系统账户文件', () => {
    expect(sensitivePathReason('~/.vrykell/config.json')).toBeTruthy();
    expect(sensitivePathReason('/Users/u/.vrykell/secrets.json')).toBeTruthy();
    expect(sensitivePathReason('/etc/shadow')).toBeTruthy();
    expect(sensitivePathReason('/etc/passwd')).toBeTruthy();
  });

  it('普通路径不命中（含子串噪声）', () => {
    expect(sensitivePathReason('/home/u/proj/src/main.ts')).toBeNull();
    expect(sensitivePathReason('/home/u/not-ssh/config')).toBeNull();
    expect(sensitivePathReason('')).toBeNull();
    // 形似但不命中：.env 后缀后跟普通字符、或 .env 不是路径段
    expect(sensitivePathReason('/home/u/file.envx')).toBeNull();
    expect(sensitivePathReason('/home/u/something-env')).toBeNull();
    // vrykell skills 目录不误伤
    expect(sensitivePathReason('~/.vrykell/skills/写单元测试/SKILL.md')).toBeNull();
  });
});