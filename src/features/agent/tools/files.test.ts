/**
 * 文件/搜索工具（M2）测试：mock Tauri invoke 边界，验证结构化结果映射
 * （execute 永不 throw；Err → { ok:false, error }）与输出格式化。
 */
import { describe, it, expect, vi } from 'vitest';

// vi.hoisted + 直接引用（对齐 ai.test.ts）。
// 注意：不要用 beforeEach 清 mock —— 本仓库 vitest 4 环境下 beforeEach 存在时
// mockRejectedValue 的 rejection 会被误报为 unhandled（探针可复现，去掉 beforeEach
// 即正常）；各用例自设 mock 实现、断言用不同参数，无需清调用历史。
const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

import { buildFileTools } from '@features/agent/tools/files';
import { buildSearchTools } from '@features/agent/tools/search';
import { usePermissions, type ToolContext } from '@features/agent/stores/permissions';

// 本文件测 invoke 参数/结果映射，不测门控（门控见 permissions.test.ts）：
// 全部工具置 allow，ctx 留空
usePermissions.setState({
  levels: {
    run_command: 'allow', read_file: 'allow', write_file: 'allow', edit_file: 'allow',
    list_dir: 'allow', search_files: 'allow', web_search: 'allow',
  },
});
const CTX: ToolContext = {};

// AI SDK tool() 包的 execute 签名较繁，这里只关心入参→结果映射；
// 第二参（{toolCallId, abortSignal}）给空对象即可（gate 在 allow 级不碰它）
type Exec = (args: Record<string, unknown>) => Promise<{ ok: boolean; result?: string; error?: string }>;
const execOf = (t: unknown): Exec => {
  const e = (t as { execute: (a: unknown, o: unknown) => Promise<never> }).execute;
  return (args) => e(args, {});
};

describe('buildFileTools', () => {
  it('read_file：透传 path/maxBytes（camelCase），返回内容', async () => {
    invokeMock.mockResolvedValue('file body');
    const r = await execOf(buildFileTools(CTX).read_file)({ path: '/tmp/a.txt', max_bytes: 100 });
    expect(invokeMock).toHaveBeenCalledWith('read_file_text', { path: '/tmp/a.txt', maxBytes: 100 });
    expect(r).toEqual({ ok: true, result: 'file body' });
  });

  it('read_file：invoke 报错 → ok:false 不 throw', async () => {
    invokeMock.mockRejectedValue(new Error('不是 UTF-8 文本文件'));
    const r = await execOf(buildFileTools(CTX).read_file)({ path: '/tmp/bin' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('UTF-8');
  });

  it('edit_file：snake_case 入参转 camelCase 透传', async () => {
    invokeMock.mockResolvedValue('已修改（1 处替换）');
    const r = await execOf(buildFileTools(CTX).edit_file)({
      path: '/tmp/a.ts',
      old_string: 'foo',
      new_string: 'bar',
    });
    expect(invokeMock).toHaveBeenCalledWith('edit_file_text', {
      path: '/tmp/a.ts',
      oldString: 'foo',
      newString: 'bar',
    });
    expect(r.ok).toBe(true);
  });

  it('write_file：错误（如备份失败）原样上浮', async () => {
    invokeMock.mockRejectedValue('备份失败: 只读文件系统');
    const r = await execOf(buildFileTools(CTX).write_file)({ path: '/tmp/x', content: 'c' });
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('备份失败') });
  });
});

describe('buildSearchTools', () => {
  it('list_dir：目录在前 + emoji 前缀；空目录给提示', async () => {
    invokeMock.mockResolvedValue([
      { name: 'src', path: '/p/src', is_dir: true },
      { name: 'a.txt', path: '/p/a.txt', is_dir: false },
    ]);
    const r = await execOf(buildSearchTools(CTX).list_dir)({ path: '/p' });
    expect(r.result).toBe('📁 src\n📄 a.txt');

    invokeMock.mockResolvedValue([]);
    const empty = await execOf(buildSearchTools(CTX).list_dir)({ path: '/p' });
    expect(empty.result).toBe('（空目录）');
  });

  it('search_files：内容模式带行号，文件名模式只给路径', async () => {
    invokeMock.mockResolvedValue([
      { path: '/p/a.ts', line: 3, preview: 'const x = 1' },
      { path: '/p/b.ts', line: null, preview: 'b.ts' },
    ]);
    const r = await execOf(buildSearchTools(CTX).search_files)({ root: '/p', query: 'x', content: true });
    expect(invokeMock).toHaveBeenCalledWith('fs_search', {
      root: '/p',
      query: 'x',
      content: true,
      maxResults: null,
    });
    expect(r.result).toBe('/p/a.ts:3  const x = 1\n/p/b.ts');
  });

  it('search_files：无匹配给提示而非空串', async () => {
    invokeMock.mockResolvedValue([]);
    const r = await execOf(buildSearchTools(CTX).search_files)({ root: '/p', query: 'nope' });
    expect(r.result).toBe('（无匹配）');
  });
});
