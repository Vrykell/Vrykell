/**
 * webSearch（M6）测试：mock Tauri invoke 边界，验证 Tavily 工具的
 * 参数传递、结果格式化与错误结构化（execute 永不 throw）。
 * 不用 beforeEach（本仓库 vitest 4 陷阱，见 files.test.ts 头注释）。
 */
import { describe, expect, it, vi } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

import { type ToolContext, usePermissions } from '@/features/agent/services/permissions';
import { buildTavilySearchTool, formatResults } from '@/features/agent/tools/webSearch';

// 本文件测 invoke 参数/结果映射，不测门控（门控见 permissions.test.ts）
usePermissions.setState({ levels: { web_search: 'allow' } });
const CTX: ToolContext = {};

type Exec = (args: Record<string, unknown>) => Promise<string | { ok: boolean; error?: string }>;
const execOf = (t: unknown): Exec => {
  const e = (t as { execute: (a: unknown, o: unknown) => Promise<never> }).execute;
  return (args) => e(args, {});
};

describe('tavily 兜底工具', () => {
  it('成功：摘要 + 编号结果列表；默认 5 条', async () => {
    invokeMock.mockResolvedValue({
      answer: 'Rust 是一门系统编程语言',
      results: [
        {
          title: 'Rust 官网',
          url: 'https://www.rust-lang.org',
          content: 'A language empowering everyone',
        },
        { title: 'Rust 中文社区', url: 'https://rustcc.cn', content: '社区' },
      ],
    });
    const r = await execOf(buildTavilySearchTool(CTX))({ query: 'rust 语言' });
    expect(invokeMock).toHaveBeenCalledWith('tavily_search', { query: 'rust 语言', maxResults: 5 });
    expect(typeof r).toBe('string');
    const s = r as string;
    expect(s).toContain('摘要：Rust 是一门系统编程语言');
    expect(s).toContain('1. Rust 官网');
    expect(s).toContain('https://rustcc.cn');
  });

  it('maxResults 透传', async () => {
    invokeMock.mockResolvedValue({ results: [] });
    await execOf(buildTavilySearchTool(CTX))({ query: 'x', maxResults: 3 });
    expect(invokeMock).toHaveBeenCalledWith('tavily_search', { query: 'x', maxResults: 3 });
  });

  it('无结果：占位提示', async () => {
    invokeMock.mockResolvedValue({ results: [] });
    const r = (await execOf(buildTavilySearchTool(CTX))({ query: '空' })) as string;
    expect(r).toContain('（无结果）');
  });

  it('invoke 失败（如未配 Key）→ { ok:false }，不 throw', async () => {
    invokeMock.mockRejectedValue(new Error('尚未配置 Tavily API Key'));
    const r = await execOf(buildTavilySearchTool(CTX))({ query: 'y' });
    expect(r).toEqual({ ok: false, error: '尚未配置 Tavily API Key' });
  });
});

describe('formatResults', () => {
  it('内容节选截断到 300 字', () => {
    const long = 'x'.repeat(500);
    const s = formatResults({ results: [{ title: 't', url: 'u', content: long }] });
    expect(s).toContain('x'.repeat(300));
    expect(s).not.toContain('x'.repeat(301));
  });
});
