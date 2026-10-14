/**
 * tools/index — buildTools 组装与 deny 过滤测试。
 */
import { describe, it, expect } from 'vitest';
import { buildTools, shellFamilyForPane } from '@features/agent/tools/index';
import { usePermissions } from '@features/agent/stores/permissions';

describe('buildTools', () => {
  it('默认注册核心工具；deny 级不注册', () => {
    usePermissions.setState({ levels: { run_command: 'deny', read_file: 'allow', web_search: 'deny' }, mode: 'standard' });
    const tools = buildTools({});
    expect(tools.run_command).toBeUndefined();
    expect(tools.read_file).toBeDefined();
    expect(tools.web_search).toBeUndefined();
    expect(tools.read_terminal).toBeDefined();
    expect(tools.use_skill).toBeDefined();
    expect(tools.install_skill).toBeDefined();
    expect(tools.memory).toBeDefined();
    expect(tools.schedule).toBeDefined();
    expect(tools.subagent).toBeDefined();
  });
});

describe('shellFamilyForPane', () => {
  it('默认「系统」shell 的本地窗格在 Windows 上按 Windows 规则判定', () => {
    // 窗格没有 shellType（新建时选择的「系统」偏好），Windows 下实际仍是 PowerShell/cmd
    expect(shellFamilyForPane({ kind: 'local' }, true)).toBe('powershell');
    expect(shellFamilyForPane(undefined, true)).toBe('powershell');
    // 其它平台仍是 POSIX 规则
    expect(shellFamilyForPane({ kind: 'local' }, false)).toBe('posix');
  });

  it('已显式指定 shell 或远程窗格时按各自规则', () => {
    expect(shellFamilyForPane({ kind: 'local', shellType: 'bash' }, true)).toBe('bash');
    expect(shellFamilyForPane({ kind: 'local', shellType: 'cmd' }, false)).toBe('cmd');
    // SSH 远端是 POSIX shell，不受本机平台影响
    expect(shellFamilyForPane({ kind: 'ssh' }, true)).toBe('posix');
  });
});
