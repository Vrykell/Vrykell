import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildNewTabOptions,
  loadRecentOpen,
  saveRecentOpen,
  touchRecentOpen,
} from '@features/workspace/model/tabTypes';
import type { ShellOption } from '@platform/shells';
import type { SshConnection } from '@features/ssh/services/api';

const shells: ShellOption[] = [
  { id: 'zsh', label: 'Zsh', default: true },
  { id: 'bash', label: 'Bash', default: false },
];

const sshs: SshConnection[] = [
  { id: 'ssh-1', name: '生产服务器', host: 'prod.example.com', user: 'root', authMethod: 'password' },
  { id: 'ssh-2', name: '测试机', host: 'staging.example.com', user: 'root', port: 2222, authMethod: 'key' },
];

describe('tabTypes 新建标签页候选', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('buildNewTabOptions 合并 shell 与 ssh 候选', () => {
    const opts = buildNewTabOptions(shells, sshs, {});
    expect(opts).toHaveLength(4);
    expect(opts.map((o) => o.key)).toEqual([
      'shell:zsh', 'shell:bash', 'ssh:ssh-1', 'ssh:ssh-2',
    ]);
  });

  it('按最近打开时间倒序，未打开的按插入顺序稳定排后', () => {
    const recent = { 'shell:bash': 200, 'ssh:ssh-2': 300 };
    const opts = buildNewTabOptions(shells, sshs, recent);
    expect(opts.map((o) => o.key)).toEqual([
      'ssh:ssh-2', 'shell:bash', 'shell:zsh', 'ssh:ssh-1',
    ]);
  });

  it('touchRecentOpen 持久化并可读回', () => {
    touchRecentOpen('shell:zsh', 123);
    expect(loadRecentOpen()['shell:zsh']).toBe(123);
    saveRecentOpen({});
    expect(loadRecentOpen()).toEqual({});
  });
});
