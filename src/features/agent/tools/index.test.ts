/**
 * tools/index — buildTools 组装与 deny 过滤测试。
 */
import { describe, it, expect } from 'vitest';
import { buildTools } from './index';
import { usePermissions } from '../permissions';

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
