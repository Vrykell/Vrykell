/**
 * webFetch — web_search/web_fetch/web_crawl 工具测试（参数透传 + 格式化 + 失败结构化）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

import { type ToolContext, usePermissions } from '@/agent/permissions';
import { buildWebCrawlTool, buildWebFetchTool, buildWebSearchTool } from '@/agent/tools/webFetch';

usePermissions.setState({
  levels: { web_search: 'allow', web_fetch: 'allow', web_crawl: 'allow' },
});
const CTX: ToolContext = {};

beforeEach(() => {
  invokeMock.mockReset();
});

type Exec = (args: Record<string, unknown>) => Promise<unknown>;
const execOf = (t: unknown): Exec => {
  const e = (t as { execute: (a: unknown, o: unknown) => Promise<never> }).execute;
  return (args) => e(args, {});
};

describe('web_search 工具', () => {
  it('成功：编号结果列表，内容截断 300 字', async () => {
    invokeMock.mockResolvedValue({
      results: [
        { title: 'A', url: 'https://a', content: 'x'.repeat(400) },
        { title: undefined, url: undefined },
      ],
    });
    const r = (await execOf(buildWebSearchTool(CTX))({ query: 'q' })) as string;
    expect(invokeMock).toHaveBeenCalledWith('web_search', { query: 'q', maxResults: 5 });
    expect(r).toContain('1. A');
    expect(r).toContain('2.');
    expect(r).toContain('x'.repeat(300));
  });

  it('maxResults 透传；空结果占位；invoke 失败结构化', async () => {
    invokeMock.mockResolvedValueOnce({ results: [] });
    const empty = (await execOf(buildWebSearchTool(CTX))({ query: 'q', maxResults: 3 })) as string;
    expect(invokeMock).toHaveBeenLastCalledWith('web_search', { query: 'q', maxResults: 3 });
    expect(empty).toContain('（无结果）');
    invokeMock.mockRejectedValueOnce(new Error('网络错误'));
    const fail = await execOf(buildWebSearchTool(CTX))({ query: 'q' });
    expect(fail).toEqual({ ok: false, error: '网络错误' });
  });

  it('门控拒绝时直接返回门控结果', async () => {
    usePermissions.setState({ levels: { web_search: 'deny' } });
    const r = await execOf(buildWebSearchTool(CTX))({ query: 'q' });
    expect(invokeMock).not.toHaveBeenCalled();
    expect(r).toBeDefined();
    usePermissions.setState({
      levels: { web_search: 'allow', web_fetch: 'allow', web_crawl: 'allow' },
    });
  });
});

describe('web_fetch 工具', () => {
  it('完整响应：标题/来源/正文/截断标记/页内链接（上限 10 条）', async () => {
    const links = Array.from({ length: 15 }, (_, i) => ({ text: `L${i}`, url: `https://l/${i}` }));
    invokeMock.mockResolvedValue({
      title: '文档',
      url: 'https://doc',
      text: '正文',
      truncated: true,
      links,
    });
    const r = (await execOf(buildWebFetchTool(CTX))({ url: 'https://doc' })) as string;
    expect(invokeMock).toHaveBeenCalledWith('web_fetch', { url: 'https://doc' });
    expect(r).toContain('标题：文档');
    expect(r).toContain('来源：https://doc');
    expect(r).toContain('[正文已截断]');
    expect(r).toContain('页内链接：');
    expect(r).toContain('10. L9');
    expect(r).not.toContain('11.');
  });

  it('最小响应：无标题/链接也正常；invoke 失败结构化', async () => {
    invokeMock.mockResolvedValueOnce({ text: '只有正文' });
    const r = (await execOf(buildWebFetchTool(CTX))({ url: 'https://x' })) as string;
    expect(r).toBe('只有正文');
    invokeMock.mockRejectedValueOnce(new Error('404'));
    const fail = await execOf(buildWebFetchTool(CTX))({ url: 'https://x' });
    expect(fail).toEqual({ ok: false, error: '404' });
  });
});

describe('web_crawl 工具', () => {
  it('成功：逐页格式化 + 截断标记；参数透传（缺省 null/true）', async () => {
    invokeMock.mockResolvedValue({
      pages: [
        { title: '首页', url: 'https://s', text: 'hello' },
        { url: 'https://s/p2', text: 'x'.repeat(9000) },
      ],
      truncated: true,
    });
    const r = (await execOf(buildWebCrawlTool(CTX))({ start_url: 'https://s' })) as string;
    expect(invokeMock).toHaveBeenCalledWith('web_crawl', {
      startUrl: 'https://s',
      maxPages: null,
      maxDepth: null,
      sameDomain: true,
    });
    expect(r).toContain('[1/2] 标题：首页');
    expect(r).toContain('URL：https://s/p2');
    expect(r).toContain('[达到页数上限，结果已截断]');
  });

  it('空页占位；自定义参数透传；invoke 失败结构化', async () => {
    invokeMock.mockResolvedValueOnce({ pages: [] });
    const empty = (await execOf(buildWebCrawlTool(CTX))({ start_url: 'https://s' })) as string;
    expect(empty).toContain('未爬取到任何页面');
    invokeMock.mockResolvedValueOnce({ pages: [{ title: 'p' }] });
    await execOf(buildWebCrawlTool(CTX))({
      start_url: 'https://s',
      max_pages: 3,
      max_depth: 1,
      same_domain: false,
    });
    expect(invokeMock).toHaveBeenLastCalledWith('web_crawl', {
      startUrl: 'https://s',
      maxPages: 3,
      maxDepth: 1,
      sameDomain: false,
    });
    invokeMock.mockRejectedValueOnce(new Error('SSRF 拦截'));
    const fail = await execOf(buildWebCrawlTool(CTX))({ start_url: 'https://s' });
    expect(fail).toEqual({ ok: false, error: 'SSRF 拦截' });
  });
});
