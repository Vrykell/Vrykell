/**
 * webSearch (M6) tests: mock the Tauri invoke boundary and verify the Tavily tool's
 * parameter passing, result formatting and error structuring (execute never throws).
 * No beforeEach (a vitest 4 trap in this repository, see the header comment in files.test.ts).
 */
import { describe, it, expect, vi } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

import { buildTavilySearchTool, formatResults } from '@features/agent/tools/webSearch';
import { usePermissions, type ToolContext } from '@features/agent/stores/permissions';
import { approvingToolContext } from '../../../test-utils/approvingToolContext';

// This file covers invoke parameter/result mapping, not gating (see permissions.test.ts for gating)
usePermissions.setState({ levels: { web_search: 'allow' } });
const CTX: ToolContext = approvingToolContext();

type Exec = (
  args: Record<string, unknown>,
) => Promise<string | { ok: boolean; error?: string }>;
const execOf = (t: unknown): Exec => {
  const e = (t as { execute: (a: unknown, o: unknown) => Promise<never> }).execute;
  return (args) => e(args, {});
};

describe('tavily fallback tool', () => {
  it('success: summary + numbered result list; 5 results by default', async () => {
    invokeMock.mockResolvedValue({
      answer: 'Rust 是一门系统编程语言',
      results: [
        { title: 'Rust 官网', url: 'https://www.rust-lang.org', content: 'A language empowering everyone' },
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

  it('passes maxResults through', async () => {
    invokeMock.mockResolvedValue({ results: [] });
    await execOf(buildTavilySearchTool(CTX))({ query: 'x', maxResults: 3 });
    expect(invokeMock).toHaveBeenCalledWith('tavily_search', { query: 'x', maxResults: 3 });
  });

  it('no results: placeholder hint', async () => {
    invokeMock.mockResolvedValue({ results: [] });
    const r = (await execOf(buildTavilySearchTool(CTX))({ query: '空' })) as string;
    expect(r).toContain('（无结果）');
  });

  it('invoke failure (for example, no key configured) -> { ok:false }, no throw', async () => {
    invokeMock.mockRejectedValue(new Error('尚未配置 Tavily API Key'));
    const r = await execOf(buildTavilySearchTool(CTX))({ query: 'y' });
    expect(r).toEqual({ ok: false, error: '尚未配置 Tavily API Key' });
  });
});

describe('formatResults', () => {
  it('content excerpt is truncated to 300 characters', () => {
    const long = 'x'.repeat(500);
    const s = formatResults({ results: [{ title: 't', url: 'u', content: long }] });
    expect(s).toContain('x'.repeat(300));
    expect(s).not.toContain('x'.repeat(301));
  });
});
