/**
 * tools/index — buildTools 组装与 deny 过滤测试。
 */
import { describe, expect, it } from 'vitest';
import { usePermissions } from '@/features/agent/services/permissions';
import { buildTools } from '@/features/agent/tools/index';

describe('buildTools', () => {
  it('默认注册核心工具；deny 级不注册', () => {
    usePermissions.setState({
      levels: { run_command: 'deny', read_file: 'allow', web_search: 'deny' },
      mode: 'standard',
    });
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
