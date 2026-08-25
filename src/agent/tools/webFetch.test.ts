/**
 * webFetch / web_crawl 工具测试：mock Tauri invoke，验证结构化结果映射、
 * 参数 camelCase 透传与错误结构化（execute 永不 throw）。不测门控。
 */
import { describe, it, expect, vi } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

import { buildWebFetchTool, buildWebCrawlTool, buildWebSearchTool } from './webFetch';
import { usePermissions, type ToolContext } from '../permissions';

usePermissions.setState({
  levels: {
    web_search: 'allow', web_fetch: 'allow', web_crawl: 'allow',
  },
});
const CTX: ToolContext = {};

type Exec = (args: Record<string, unknown>) => Promise<string | { ok: boolean; error?: string }>;
const execOf = (t: unknown): Exec => {
  const e = (t as { execute: (a: unknown, o: unknown) => Promise<never> }).execute;
  return (args) => e(args, {});
};

describe('buildWebFetchTool', () => {
  it('结构化响应：标题 + 正文 + 页内链接 + 截断标记', async () => {
    invokeMock.mockResolvedValue({
      title: 'Rust 官方文档',
      url: 'https://doc.rust-lang.org/book/',
      content_type: 'text/html',
      headings: ['第一章', '第二章'],
      text: '# 第一章\n正文内容',
      links: [{ text: '下一章', url: 'https://doc.rust-lang.org/book/ch2.html' }],
      truncated: false,
    });
    const r = (await execOf(buildWebFetchTool(CTX))({ url: 'https://doc.rust-lang.org/book/' })) as string;
    expect(invokeMock).toHaveBeenCalledWith('web_fetch', { url: 'https://doc.rust-lang.org/book/' });
    expect(r).toContain('标题：Rust 官方文档');
    expect(r).toContain('# 第一章');
    expect(r).toContain('页内链接：');
    expect(r).toContain('https://doc.rust-lang.org/book/ch2.html');
  });

  it('invoke 失败 → { ok:false } 不 throw', async () => {
    invokeMock.mockRejectedValue(new Error('返回 404：Not Found'));
    const r = await execOf(buildWebFetchTool(CTX))({ url: 'https://x.com/nope' });
    expect(r).toEqual({ ok: false, error: '返回 404：Not Found' });
  });
});

describe('buildWebCrawlTool', () => {
  it('多页结构化 + snake_case 参数透传 + 截断标记', async () => {
    invokeMock.mockResolvedValue({
      pages: [
        { title: '首页', url: 'https://site.com/', text: '欢迎', headings: ['h1'] },
        { title: '文档', url: 'https://site.com/docs', text: '指南', headings: ['h2'] },
      ],
      truncated: false,
    });
    const r = (await execOf(buildWebCrawlTool(CTX))({
      start_url: 'https://site.com/', max_pages: 5, max_depth: 2, same_domain: true,
    })) as string;
    expect(invokeMock).toHaveBeenCalledWith('web_crawl', {
      startUrl: 'https://site.com/', maxPages: 5, maxDepth: 2, sameDomain: true,
    });
    expect(r).toContain('[1/2]');
    expect(r).toContain('标题：首页');
    expect(r).toContain('[2/2]');
    expect(r).toContain('指南');
  });

  it('未爬到任何页面给占位提示', async () => {
    invokeMock.mockResolvedValue({ pages: [], truncated: false });
    const r = (await execOf(buildWebCrawlTool(CTX))({ start_url: 'https://x.com/' })) as string;
    expect(r).toBe('（未爬取到任何页面）');
  });
});

describe('buildWebSearchTool', () => {
  it('DuckDuckGo 兜底：结果编号列表', async () => {
    invokeMock.mockResolvedValue({
      results: [{ title: 't', url: 'u', content: 'c' }],
    });
    const r = (await execOf(buildWebSearchTool(CTX))({ query: 'q' })) as string;
    expect(invokeMock).toHaveBeenCalledWith('web_search', { query: 'q', maxResults: 5 });
    expect(r).toContain('1. t');
    expect(r).toContain('u');
  });
});
