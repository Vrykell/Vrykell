/**
 * File/search tool (M2) tests: mock the Tauri invoke boundary, verify structured result mapping
 * (execute never throws; Err -> { ok:false, error }) and output formatting.
 */
import { describe, it, expect, vi } from 'vitest';

// vi.hoisted plus direct references (matching ai.test.ts).
// Note: do not clear mocks in beforeEach - under this repository's vitest 4 setup a rejection
// from mockRejectedValue is misreported as unhandled when beforeEach exists (reproducible with a
// probe; removing beforeEach fixes it). Each test sets its own mock implementation and asserts
// with different arguments, so there is no need to clear call history.
const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

import { buildFileTools } from '@features/agent/tools/files';
import { buildSearchTools } from '@features/agent/tools/search';
import { usePermissions, type ToolContext } from '@features/agent/stores/permissions';
import { approvingToolContext } from '../../../test-utils/approvingToolContext';

// This file tests invoke argument/result mapping, not gating (gating lives in permissions.test.ts):
// every tool is set to allow and ctx stays empty.
usePermissions.setState({
  levels: {
    run_command: 'allow', read_file: 'allow', write_file: 'allow', edit_file: 'allow',
    list_dir: 'allow', search_files: 'allow', web_search: 'allow',
  },
});
const CTX: ToolContext = approvingToolContext();

// The execute signature added by the tool() wrapper is verbose; only the input -> result mapping
// matters here. An empty second argument ({toolCallId, abortSignal}) is enough because the allow
// level gate never touches it.
type Exec = (args: Record<string, unknown>) => Promise<{ ok: boolean; result?: string; error?: string }>;
const execOf = (t: unknown): Exec => {
  const e = (t as { execute: (a: unknown, o: unknown) => Promise<never> }).execute;
  return (args) => e(args, {});
};

describe('buildFileTools', () => {
  it('read_file: passes path/maxBytes through (camelCase) and returns the content', async () => {
    invokeMock.mockResolvedValue('file body');
    const r = await execOf(buildFileTools(CTX).read_file)({ path: '/tmp/a.txt', max_bytes: 100 });
    expect(invokeMock).toHaveBeenCalledWith('read_file_text', { path: '/tmp/a.txt', maxBytes: 100, lease: 'test-lease' });
    expect(r).toEqual({ ok: true, result: 'file body' });
  });

  it('read_file: invoke failure -> ok:false without throwing', async () => {
    invokeMock.mockRejectedValue(new Error('不是 UTF-8 文本文件'));
    const r = await execOf(buildFileTools(CTX).read_file)({ path: '/tmp/bin' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('UTF-8');
  });

  it('edit_file: converts snake_case input to camelCase before passing it through', async () => {
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
      lease: 'test-lease',
    });
    expect(r.ok).toBe(true);
  });

  it('write_file: surfaces errors (such as a backup failure) unchanged', async () => {
    invokeMock.mockRejectedValue('备份失败: 只读文件系统');
    const r = await execOf(buildFileTools(CTX).write_file)({ path: '/tmp/x', content: 'c' });
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('备份失败') });
  });
});

describe('buildSearchTools', () => {
  it('list_dir: directories first with emoji prefixes; empty directory gets a hint', async () => {
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

  it('search_files: content mode includes line numbers, filename mode returns paths only', async () => {
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
      lease: 'test-lease',
    });
    expect(r.result).toBe('/p/a.ts:3  const x = 1\n/p/b.ts');
  });

  it('search_files: no matches yields a hint instead of an empty string', async () => {
    invokeMock.mockResolvedValue([]);
    const r = await execOf(buildSearchTools(CTX).search_files)({ root: '/p', query: 'nope' });
    expect(r.result).toBe('（无匹配）');
  });
});
